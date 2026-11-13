import { deliverReview } from "@/server/review-heartbeat";
import { handleReview } from "@/server/bedrock";
import { fetchBedrock } from "@/server/bedrock-fetch";

export const runtime = "nodejs";
// Leave response-finalization headroom beyond the server round deadline.
export const maxDuration = 300;

export async function POST(request: Request) {
  return deliverReview(request, handleReview, fetchBedrock);
}
