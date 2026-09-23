import "server-only";
import { ApiError } from "@/lib/errors";

// PRD: the only live mapping call is geocoding once at listing creation
// (Section 7). The provider is not named, so this seam fails closed until
// the owner names one. Search and browse afterwards run against stored
// coordinates only.

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type Geocoder = (address: string, country?: string | null) => Promise<GeoPoint>;

export const geocoder: Geocoder = async () => {
  throw ApiError.config(
    "Geocoding provider not configured. The PRD names none; geocoding fails closed until one is added.",
  );
};