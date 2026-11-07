import { handleReview } from "@/server/bedrock";

export const runtime = "nodejs";
// Leave response-finalization headroom beyond the server round deadline.
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleReview(request);
}
