# Superadministrator operational guide

The in-app operational guide is maintained in `src/components/SystemAdminGuide.tsx` and is available from the Superadministrator's **Guia e soluções** tab. It includes a searchable overview of modules and troubleshooting instructions.

Whenever a module, workflow, permission, recovery procedure, or common failure mode changes, update the relevant in-app entry in the same change. Keep instructions consistent with the server implementation and current UI. In particular:

- distinguish offline consultation from actions that require a live server response;
- do not describe an order or bed as complete/released until the server confirms the final state;
- explain clinical offline synchronization and how to identify pending or failed actions;
- avoid asking staff to include passwords, MFA codes, or unnecessary clinical data in support requests.

The desktop session lifetime is 12 hours. Operational PWA status changes require a live server connection; Enfermagem's queued clinical actions follow the separate encrypted synchronization workflow.
