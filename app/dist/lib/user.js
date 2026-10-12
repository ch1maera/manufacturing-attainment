//#region server/lib/user.ts
const PLACEHOLDER_EMAIL = "local_user@databricks.com";
function getCurrentUserEmail(req) {
	const h = req.headers;
	const forwardedEmail = h["x-forwarded-email"] ?? "";
	if (forwardedEmail) return forwardedEmail;
	const forwardedUser = h["x-forwarded-user"] ?? "";
	if (forwardedUser.includes("@")) return forwardedUser;
	return process.env.DEV_USER_EMAIL ?? PLACEHOLDER_EMAIL;
}
function getCurrentUserInfo(req) {
	const h = req.headers;
	return {
		userName: h["x-forwarded-preferred-username"] ?? h["x-forwarded-user"] ?? process.env.USER ?? "dev-user",
		userEmail: h["x-forwarded-email"] ?? null,
		workspaceUrl: process.env.DATABRICKS_HOST ?? "",
		workspaceId: process.env.DATABRICKS_WORKSPACE_ID ?? null
	};
}

//#endregion
export { getCurrentUserEmail, getCurrentUserInfo };