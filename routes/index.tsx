import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import GlassClouds from "../components/GlassClouds.tsx";
import Hero from "../components/Hero.tsx";
import WhatIsAtmosphere from "../components/WhatIsAtmosphere.tsx";
import OnePlace from "../components/OnePlace.tsx";
import Features from "../components/Features.tsx";
import BlueskySection from "../components/BlueskySection.tsx";
import CrossPollination from "../components/CrossPollination.tsx";
import YourChoice from "../components/ModerationAndAlgorithms.tsx";
import Footer from "../components/Footer.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";

export default define.page(function Home(ctx) {
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={buildAccountMenuProps(ctx.state)} />
        <Hero />
        <WhatIsAtmosphere />
        <OnePlace />
        <Features />
        <BlueskySection />
        <CrossPollination />
        <YourChoice />
        <Footer />
      </div>
    </div>
  );
});
