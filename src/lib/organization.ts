export const DEFAULT_ORGANIZATION_ID =
  process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? "default";

export const orgCollectionPath = (orgId: string, collection: string) =>
  `organizations/${orgId}/${collection}`;

export const orgDocPath = (orgId: string, collection: string, docId: string) =>
  `organizations/${orgId}/${collection}/${docId}`;

export const orgPreventiveTemplatesPath = (orgId: string) =>
  orgCollectionPath(orgId, "preventiveTemplates");

export const orgStoragePath = (orgId: string, ...parts: string[]) =>
  `orgs/${orgId}/${parts.filter(Boolean).join("/")}`;
