import { handleReview } from "@/server/bedrock";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleReview(request);
}
