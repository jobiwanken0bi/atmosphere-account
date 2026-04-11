import LottieSection from "./LottieSection.tsx";

export default function OnePlace() {
  const items = [
    "Posts",
    "Likes",
    "Follows",
    "Comments",
    "Lists",
    "Videos",
    "Photos",
    "Blogs",
  ];

  return (
    <section class="section-sm reveal">
      <div class="container-narrow text-center">
        <LottieSection />
        <h2 class="text-section">Everything in one place.</h2>
        <div class="divider" />
        <p class="text-body mt-2">
          All your stuff — from every Atmosphere app you use — lives in your one
          Atmosphere account. Sign in anywhere, pick up right where you left off.
        </p>
        <p class="text-body-sm mt-3 hub-examples-label">
          A few examples — there’s no fixed list. New apps bring new kinds of data,
          all in one place.
        </p>
        <div class="hub-visual">
          {items.map((item) => (
            <span key={item} class="hub-tag">
              {item}
            </span>
          ))}
          <span class="hub-tag hub-tag-more">…and many more</span>
        </div>
      </div>
    </section>
  );
}
