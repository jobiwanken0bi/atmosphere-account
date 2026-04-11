import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import GlassClouds from "../components/GlassClouds.tsx";
import AppShowcase from "../components/AppShowcase.tsx";
import Footer from "../components/Footer.tsx";

export default define.page(function Explore() {
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav />
        <section style={{ paddingTop: "8rem" }}>
          <AppShowcase />
        </section>
        <Footer />
      </div>
    </div>
  );
});
