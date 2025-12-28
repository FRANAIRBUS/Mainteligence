# Cloud Build CreateBuild audit log troubleshooting

This document captures how to interpret and remediate `CreateBuild` failures triggered from Firebase App Hosting service agents, using the following audit log entry as an example:

```
audit_log, method: "google.devtools.cloudbuild.v1.CloudBuild.CreateBuild", principal_email: service-975118694386@gcp-sa-firebaseapphosting.iam.gserviceaccount.com
```

## What the log means

- **Principal**: The request comes from the Firebase App Hosting managed service account (`gcp-sa-firebaseapphosting`).
- **Operation**: The service tried to create a Cloud Build in the specified project and region (`europe-west4`).
- **Status code 9**: gRPC code 9 corresponds to `FAILED_PRECONDITION`. The API granted `cloudbuild.builds.create`, but the build could not start because a prerequisite was missing.

## Common causes and fixes

1. **Cloud Build region not initialized**
   - Ensure that Cloud Build is set up in the target region (`europe-west4` in the log). Go to **Cloud Build → Settings → Default region** and select or confirm the region, then retry the deploy.
2. **Service account permissions**
   - The Firebase App Hosting service agent needs the Cloud Build Service Account role on the project (or a custom role granting `cloudbuild.builds.*`). Verify the binding on `service-975118694386@gcp-sa-firebaseapphosting.iam.gserviceaccount.com`.
3. **Missing service enablement**
   - Confirm that the **Cloud Build API** is enabled for the project. If it was recently enabled, wait a few minutes for propagation before redeploying.
4. **Org policy or billing constraints**
   - FAILED_PRECONDITION can also arise from organization policies blocking builds or from suspended billing. Review org policy constraints related to Cloud Build and ensure the project has active billing.

## How to validate after fixes

- Re-run the Firebase App Hosting deploy. If successful, the audit log entries will show `status.code: 0` and the build will proceed to `WORKING` state.
- Optionally, create a small test build with `gcloud builds submit` in the same region to verify that Cloud Build can start builds outside of App Hosting.
