import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { NonRetryableError } from "cloudflare:workflows";
import { gradeTranscript } from "./grading";
import { getProblem } from "./problems";
import type { ChatAgent } from "./server";

export interface GradingParams {
  sessionId: string;
  problemId: string;
  transcript: string;
}

// grade → save (scores, session, weak_topics) → sleep → revision nudge.
// `this.agent` routes back to the ChatAgent instance that started the run.
export class GradingWorkflow extends AgentWorkflow<ChatAgent, GradingParams> {
  async run(event: AgentWorkflowEvent<GradingParams>, step: AgentWorkflowStep) {
    const { sessionId, problemId, transcript } = event.payload;

    const grade = await step.do(
      "grade",
      {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
        timeout: "2 minutes"
      },
      async () => {
        const problem = getProblem(problemId);
        if (!problem)
          throw new NonRetryableError(`Unknown problem ${problemId}`);
        return gradeTranscript(this.env.AI, problem, transcript);
      }
    );

    await step.do("save", async () => {
      await this.agent.saveGrade(sessionId, grade);
    });
    await step.mergeAgentState({
      grading: { status: "done", sessionId, ...grade }
    });

    await step.sleep(
      "revision-delay",
      this.env.NUDGE_DELAY as WorkflowSleepDuration
    );

    await step.do("nudge", async () => {
      await this.agent.createNudge(sessionId);
    });
  }
}
