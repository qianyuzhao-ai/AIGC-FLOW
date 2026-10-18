export async function apiError(response: Response): Promise<Error> {
  const body: unknown = await response.json();
  const message =
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : `请求失败（${response.status}）`;
  return new Error(message);
}
