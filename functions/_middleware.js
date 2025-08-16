// functions/_middleware.js
export async function onRequest(context) {
  const EXPECTED_PASSWORD = "kanda"; // our password

  const auth = context.request.headers.get("Authorization");
  if (auth && auth.startsWith("Basic ")) {
    const decoded = atob(auth.split(" ")[1] || "");
    const suppliedPassword = decoded.split(":").slice(1).join(":");
    if (suppliedPassword === EXPECTED_PASSWORD) {
      return context.next(); // ✅ allow if password matches
    }
  }

  // ❌ wrong or missing password → show login popup
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="YogaTools.ai"' },
  });
}
