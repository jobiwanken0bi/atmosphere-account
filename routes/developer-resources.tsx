import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import GlassClouds from "../components/GlassClouds.tsx";
import DeveloperResources from "../components/DeveloperResources.tsx";
import Footer from "../components/Footer.tsx";

export default define.page(function DeveloperResourcesPage() {
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav />
        <section style={{ paddingTop: "8rem" }}>
          <DeveloperResources />
        </section>
        <Footer />
      </div>
    </div>
  );
});
