/** For the load balancer. It says the server is up, and touches neither the AI nor the store. */
export function GET() {
  return Response.json({ ok: true });
}
