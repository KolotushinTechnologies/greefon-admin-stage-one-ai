import type { FeatureExtractionPipeline } from "@xenova/transformers";
import type { AppEnv } from "../../config/env.js";

export class XenovaEmbeddingService {
  private extractor: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly env: AppEnv) {}

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(`query: ${text}`);
  }

  async embedPassage(text: string): Promise<number[]> {
    return this.embed(`passage: ${text}`);
  }

  private async embed(prepared: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(prepared, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) {
      return this.extractor;
    }
    if (!this.loading) {
      this.loading = (async () => {
        const { pipeline } = await import("@xenova/transformers");
        const created = await pipeline("feature-extraction", this.env.EMBEDDING_MODEL);
        this.extractor = created;
        return created;
      })();
    }
    return this.loading;
  }
}
