//#region server/chat-stream/sse.ts
function sseWrite(res, event) {
	if (res.writableEnded || res.destroyed) return;
	res.write(`data: ${JSON.stringify(event)}\n\n`);
}
function sseError(res, error) {
	sseWrite(res, {
		type: "error",
		error
	});
}

//#endregion
export { sseError, sseWrite };