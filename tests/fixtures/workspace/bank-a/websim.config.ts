import { Hono } from "hono";
import banking from "../../account/websim.config.js";
import type { SimulationEnv } from "../../../../src/index.js";
const scroll = new Hono<SimulationEnv>();
scroll.get("/", (c) =>
  c.html(
    `<!doctype html><style>body{margin:0;height:3000px}section{position:absolute;top:20px;width:550px;height:500px;overflow:auto;border:2px solid}#left{left:20px}#right{left:650px}article{width:2000px;height:3000px;background:repeating-linear-gradient(#eee 0 90px,#999 90px 100px)}</style><section id="left"><article>Left pane</article></section><section id="right"><article>Right pane</article></section><script>for(const id of ['left','right']){const element=document.getElementById(id);element.addEventListener('scroll',()=>fetch('/position',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,x:element.scrollLeft,y:element.scrollTop})}));}</script>`,
  ),
);
scroll.post("/position", async (c) => {
  const { id, x, y } = await c.req.json();
  c.get("simulation").state.set("scroll", id, { x, y });
  return c.body(null, 204);
});
export default {
  ...banking,
  modules: [
    ...banking.modules,
    {
      name: "scroll-fixture",
      origin: "https://scroll.example",
      routes: scroll,
    },
  ],
};
