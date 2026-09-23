import "server-only";
import { ApiError } from "@/lib/errors";

// PRD does not name a storage provider (UP-1). /lib/storage owns storage
// mechanics and NEVER decides access (UP-4); /modules decide whether a
// signed URL may be issued. Until the owner names a provider all calls
// fail closed (UP-13): no public bucket, no fallback.

export const DOCUMENT_URL_TTL_SECONDS = 300; // UP-5
export const IMAGE_URL_TTL_SECONDS = 900; // UP-5

export interface StorageService {
  assertObjectExists(key: string): Promise<void>;
  issueDocumentUrl(key: string): Promise<string>;
  issueImageUrl(key: string): Promise<string>;
}

function providerUnconfigured(bucket: string | undefined): boolean {
  return !bucket;
}

function signedUrlAvailable(): string {
  if (providerUnconfigured(process.env.STORAGE_BUCKET)) {
    throw ApiError.config(
      "Storage provider not configured. The PRD names none; /lib/storage fails closed until one is added.",
    );
  }
  throw new Error("storage-write-error");
}

export const storage: StorageService = {
  async assertObjectExists(): Promise<void> {
    if (providerUnconfigured(process.env.STORAGE_BUCKET)) {
      throw ApiError.config(
        "Storage provider not configured. The PRD names none; /lib/storage fails closed until one is added.",
      );
    }
    // The provider SDK is added here when the owner names one (UP-9).
    throw ApiError.config(
      "Storage provider not configured. The PRD names none; /lib/storage fails closed until one is added.",
    );
  },
  issueDocumentUrl(): Promise<string> {
    signedUrlAvailable();
    throw new Error("unreachable");
  },
  issueImageUrl(): Promise<string> {
    signedUrlAvailable();
    throw new Error("unreachable");
  },
};