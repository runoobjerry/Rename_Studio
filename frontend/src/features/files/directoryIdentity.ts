import type { DirectoryListing, RenameFile } from "../../types";

// Navigation roots can represent a real cloud folder ID; display paths are never identities.
export function isInDirectory(listing: DirectoryListing | undefined, file: RenameFile): boolean | null {
  const parent = file.parent_location;
  if (!listing || !parent) return null;
  if (listing.directory_id != null) {
    return parent.kind === "id" ? parent.value === listing.directory_id : null;
  }
  const location = listing.location;
  if (!location) return null;
  // Without a resolved root ID, an ID and a logical root cannot be compared.
  if (parent.kind !== location.kind) {
    return parent.kind === "id" || location.kind === "id" ? null : false;
  }
  return parent.kind === "root" || (location.kind !== "root" && parent.value === location.value);
}
