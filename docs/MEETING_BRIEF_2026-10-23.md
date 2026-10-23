# DTCC meeting brief - October 23, 2026

Platform: https://dtcc-multi-agent-audit.vercel.app/
Repository: https://github.com/ChaoLabs/dtcc-multi-agent-audit

Use the script after applying the patch and verifying the version you will demonstrate. If it is not yet deployed, open the local build and say “the updated local version” instead of “the website.” Do not describe a mocked test as a live AWS result.

## Ready-to-read opening (about three to four minutes)

Hi everyone. Following our last meeting, I focused on making the existing three-model workflow more controlled and easier to evaluate. I kept the same five Solidity test contracts, so we can work on stability before expanding the dataset.

The first change is a bounded orchestration supervisor. GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 still review the same contract independently through Amazon Bedrock. Each model can now make at most two attempts. The second attempt is allowed only for specific transient responses, such as throttling or a temporary service error. Invalid permissions, invalid evidence and malformed output are not repeatedly retried.

There is also a fixed time budget. Each model has a 180-second deadline, and the overall server request has a 210-second deadline. A retry does not restart those clocks. One contract analysis can make at most six provider requests. If one model fails, the successful reviews remain available, and the missing coverage is shown explicitly.

The second change is better traceability. We can inspect which models completed, how many attempts they used, and where findings differ. The orchestrator keeps the original contributions and highlights severity differences and findings with incomplete model support. It does not treat a missing finding as an explicit rejection, and it does not treat a failed model as a vote.

The confidence display still means model agreement. Three out of three means all three models reported a compatible finding. It does not mean a 100 percent probability that the finding is correct. Source validation confirms that the cited code exists at the reported lines; it does not prove that an exploit works.

The third change is a controlled way to evaluate in-context learning. We can choose the standard prompt or guided examples. The guided version uses separate synthetic examples, including a benign lookalike, and applies the same instructions to all three models. It does not include answers from our five test contracts or copy another model's output.

I also added a five-case validation workflow. It runs the existing contracts one at a time, supports cancellation, and exports the outcomes for comparison. One prompt variant is a separate, explicitly started run. That lets us compare completion, retries, latency, available token usage and disagreements without changing the dataset.

The automated checks validate application behavior using simulated provider responses. They are useful for testing timeouts, retries and failure handling, but they do not establish live Bedrock availability or better vulnerability detection. My proposed next step is to collect the same five-case results for both prompt variants, have the team review the findings, and use that evidence to decide what to improve next.

I would also like us to agree on the criteria for an actionable finding and divide the review work so that everyone can bring a specific observation or question to the next meeting.

## Demo sequence (about four minutes)

| Action | What to say |
| --- | --- |
| Open the workspace and select Vault withdrawal | “I am using the same reference contract as before, so the comparison remains consistent.” |
| Run static analysis | “This baseline runs in the browser without an API key. It identifies source patterns for review.” |
| Select API analysis; connect with a fresh key before screen sharing | “The key is kept in this tab's memory. The website sends the source through its server to Bedrock when I start analysis.” |
| Show the Standard / Guided examples prompt controls and execution limits | “This setting is shared by all three independent reviewers. The attempt and time limits apply to the whole model task, including a retry.” |
| Run one API analysis, or inspect a saved result while it completes | “I am looking for three explicit model outcomes. A partial run remains useful, but it is labeled as incomplete.” |
| Expand a finding and its original contributions | “Here are the source evidence, individual proposals and agreement. A severity difference remains visible instead of being hidden by an average.” |
| Select Validate 5 cases; show the budget before starting | “This runs our five existing cases sequentially. One variant can issue up to 30 provider requests; it does not automatically run both variants.” |
| Select Download validation JSON for a completed run or show a previous export | “This records the prompt settings and operational outcomes, so we can compare repeated runs rather than relying on a screenshot.” |
| Open Documentation | “The PDF now explains the bounded execution policy and the controlled evaluation workflow alongside the platform's core functions.” |

A live review may take up to three minutes. Do not spend the whole meeting waiting: explain the controls, show a previously exported result and return to the live outcome. If using a previous result, name it as a previous result. Do not initiate a five-case suite solely to fill demonstration time; confirm that the meeting has enough time and the AWS budget is appropriate.

## If a model fails during the demo

“Here the platform has reached a bounded failure rather than continuing indefinitely. We can inspect the affected model and its recorded attempts, while keeping the reviews that completed. I will preserve this result in the evaluation record. A failure alone does not tell us whether the cause is permissions, quota or a temporary service problem; the error category helps distinguish those cases.”

If the key is rejected: “This is an access issue, so the supervisor stops rather than repeatedly calling with the same credential. I will reconnect with a current authorized key after the meeting. The static workflow remains available.”

## Questions to invite team participation

1. “For these five cases, what should we require before calling a finding actionable: a source-grounded explanation, a reproducible exploit, or both?”
2. “Can we divide the five cases for independent human review, with someone else checking disputed findings?”
3. “What run budget and repetition count are appropriate for comparing the standard and guided prompts in our AWS account?”
4. “Which operational target should we prioritize first: complete three-model coverage, fewer timeouts, or predictable response time?”
5. “Does the current deterministic supervisor meet the orchestration requirement, or would you like us to evaluate an additional model-based adjudication stage as a separate experiment?”

## Short answers for likely questions

**Is this a fourth AI agent?**

“The supervisor is deterministic application code. It manages execution and reconciles validated findings without another model call. A separate model-based adjudicator would be a different design, with additional cost and evaluation requirements.”

**Did in-context learning improve accuracy?**

“I have made it a controlled option and added a comparison workflow. I have not claimed a measured quality improvement. We need repeated live results and reviewed labels before drawing that conclusion.”

**Why not just retry everything?**

“A retry can help a temporary service error, but it cannot fix missing permissions or fabricated evidence. Limiting retries avoids repeated spending and prevents a run from continuing indefinitely.”

**Do three agreeing models prove the contract is vulnerable?**

“No. Agreement is corroboration between model outputs. Their errors can be correlated, and the source checks do not validate exploitability. We keep the original evidence for human review.”

**What is the cost limit?**

“There is a request-count limit: at most six provider requests per contract and 30 per five-case variant. Each attempt also has an output limit. That is not a dollar guarantee; failed or cancelled provider work can still be billed, and some usage may not be returned.”

**Why keep only five contracts?**

“That follows our agreed priority. Keeping the input set fixed helps us isolate execution and prompt changes. These are teaching examples, so we will not use them to claim general accuracy.”

## Before the meeting

- Apply the patch, run its checks and confirm that the browser is showing the intended local or deployed version.
- Use a fresh authorized key; enter it before screen sharing and keep network request bodies out of view.
- Run one small live analysis. If access is healthy and budget permits, save one five-case result for the standard prompt and one for guided examples.
- Keep the exported records, current PDF and repository link ready. Record any failed or interrupted run as well.
- Separate what is implemented, what was verified with simulated responses, and what you actually observed in live AWS runs. Avoid accuracy, cost-saving or hallucination-reduction percentages without measured evidence.
