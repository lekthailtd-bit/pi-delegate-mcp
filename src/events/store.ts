import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SubscriptionRecord {
  id: string;
  principal: string;
  name: string;
  arguments: Record<string, unknown>;
  delivery: { mode: "webhook"; url: string; secret: string };
  previousSecret?: string;
  previousSecretUntil?: string;
  cursor: string | null;
  refreshBefore: string;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  version: 1;
  subscriptions: SubscriptionRecord[];
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function subscriptionId(
  principal: string,
  callbackUrl: string,
  name: string,
  args: Record<string, unknown>,
): string {
  const identity = [principal, callbackUrl, name, canonicalJson(args)].join("\n");
  return `sub_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function looksLikeSubscription(value: unknown): value is SubscriptionRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SubscriptionRecord>;
  return (
    typeof v.id === "string" &&
    typeof v.principal === "string" &&
    typeof v.name === "string" &&
    Boolean(v.arguments) &&
    v.delivery?.mode === "webhook" &&
    typeof v.delivery.url === "string" &&
    typeof v.delivery.secret === "string" &&
    typeof v.refreshBefore === "string"
  );
}

export class FileSubscriptionStore {
  private mutation = Promise.resolve();

  constructor(readonly file: string) {}

  async list(): Promise<SubscriptionRecord[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<StoreFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.subscriptions)) return [];
      return parsed.subscriptions.filter(looksLikeSubscription);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(id: string): Promise<SubscriptionRecord | undefined> {
    return (await this.list()).find((subscription) => subscription.id === id);
  }

  async active(now = Date.now()): Promise<SubscriptionRecord[]> {
    return (await this.list()).filter((subscription) => Date.parse(subscription.refreshBefore) > now);
  }

  async upsert(record: SubscriptionRecord): Promise<void> {
    await this.lock(async () => {
      const all = await this.list();
      const index = all.findIndex((subscription) => subscription.id === record.id);
      if (index >= 0) all[index] = record;
      else all.push(record);
      await this.write(all);
    });
  }

  async remove(id: string): Promise<void> {
    await this.lock(async () => {
      const all = await this.list();
      const next = all.filter((subscription) => subscription.id !== id);
      if (next.length !== all.length) await this.write(next);
    });
  }

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.mutation;
    let release!: () => void;
    this.mutation = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async write(subscriptions: SubscriptionRecord[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    const body = `${JSON.stringify({ version: 1, subscriptions }, null, 2)}\n`;
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
    try {
      await rename(temporary, this.file);
    } catch (error) {
      if (process.platform !== "win32") throw error;
      await rm(this.file, { force: true });
      await rename(temporary, this.file);
    }
  }
}
