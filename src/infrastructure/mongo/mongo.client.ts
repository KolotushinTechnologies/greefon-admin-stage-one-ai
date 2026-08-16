import { MongoClient, type Db } from "mongodb";
import type { AppEnv } from "../../config/env.js";

export class MongoConnection {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(private readonly env: AppEnv) {}

  async connect(): Promise<Db> {
    if (this.db) {
      return this.db;
    }
    this.client = new MongoClient(this.env.MONGODB_URI);
    await this.client.connect();
    this.db = this.client.db();
    return this.db;
  }

  getDb(): Db {
    if (!this.db) {
      throw new Error("Mongo ещё не подключена");
    }
    return this.db;
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.db = null;
  }
}
