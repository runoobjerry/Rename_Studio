import { oneDriveSiteAdapter } from "./onedrive.js";

import { googleDriveSiteAdapter } from "./google-drive.js";

// Only bundled website adapters may select an extraction function.
const adapters = [oneDriveSiteAdapter, googleDriveSiteAdapter];
export const findSiteAdapter = (origin) => adapters.find((adapter) => adapter.origin === origin);
export const findRequestAdapter = (type) => adapters.find((adapter) => adapter.requestType === type);
