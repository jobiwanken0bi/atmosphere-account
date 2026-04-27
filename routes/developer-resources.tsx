import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import DeveloperResources from "../components/DeveloperResources.tsx";
import Footer from "../components/Footer.tsx";

export default define.page(function DeveloperResourcesPage() {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav disableScrollEffects />
        <section style={{ paddingTop: "8rem" }}>
          <DeveloperResources />
        </section>
        <Footer />
      </div>
    </div>
  );
});
