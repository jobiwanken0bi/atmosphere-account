export default function HowItWorks() {
  const pillars = [
    {
      number: "1",
      title: "Identity",
      description:
        "One universal account that belongs to you. Your handle is a domain — even one you already own. No platform can take it away.",
    },
    {
      number: "2",
      title: "Connections",
      description:
        "Your social graph travels with you. Creators keep their audiences. Find the same people across every app. No more starting over.",
    },
    {
      number: "3",
      title: "Choice",
      description:
        "Choose your apps, algorithms, and moderation. Don't like something? Switch and pick up where you left off. It's your call, always.",
    },
  ];

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">How it works.</h2>
          <div class="divider" />
        </div>
        <div class="pillars-grid">
          {pillars.map((p) => (
            <div key={p.title} class="glass pillar-card">
              <div class="pillar-number">{p.number}</div>
              <h3 class="text-subsection mb-2">{p.title}</h3>
              <p class="text-body-sm">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
