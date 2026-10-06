import { Text } from "@cloudflare/kumo";

const STEPS = [
  {
    title: "Get a problem",
    body: "Pick a difficulty and click “New problem”."
  },
  {
    title: "Explain your approach",
    body: "Talk it through in the chat. The interviewer gives hints, not answers."
  },
  {
    title: "Submit & grade",
    body: "You're scored 0–10 on each of the problem's topics."
  },
  {
    title: "The coach remembers",
    body: "Weak topics are targeted in your next problems, and you get a reminder to revise them."
  }
];

export function WelcomeCard() {
  return (
    <div className="rounded-2xl border border-kumo-line bg-kumo-base p-6">
      <Text variant="heading3" as="h2">
        Welcome to your DSA mock interview
      </Text>
      <ol className="mt-4 space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kumo-contrast text-xs font-semibold text-kumo-inverse">
              {i + 1}
            </span>
            <div>
              <Text size="sm" bold>
                {step.title}
              </Text>
              <div>
                <Text size="sm" variant="secondary">
                  {step.body}
                </Text>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
