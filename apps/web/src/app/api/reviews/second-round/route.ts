import { handleSecondReview } from "@/server/second-review";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  return handleSecondReview(request);
}
