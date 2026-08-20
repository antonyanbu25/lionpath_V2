const SIZE_HEIGHTS = { sm: 34, md: 42, lg: 50 };
const DEFAULTS = {
  size: "lg", radius: 18, tint: "#ffffff", tintOpacity: 0, blur: 0,
  textColor: "#f5f5f5", lineColor: "#ffffff", baseColor: "#525252",
  intensity: 1, shineSize: 10, shineFade: 40, thickness: 1, speed: 0.35,
  followMouse: true, proximity: 250, autoAnimate: false, disabled: false,
};

const VS = `attribute vec2 a_position;varying vec2 v_uv;void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;
const FS = `
precision mediump float;varying vec2 v_uv;uniform vec2 u_resolution;
uniform float u_radius,u_thickness,u_time,u_lightAngle,u_focus,u_auto,u_intensity,u_shineSize,u_shineFade,u_tintOpacity;
uniform vec3 u_tint,u_lineColor,u_baseColor;
float roundedRectSdf(vec2 p,vec2 h,float r){vec2 q=abs(p)-h+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
void main(){vec2 p=(v_uv-.5)*u_resolution;vec2 h=u_resolution*.5;float r=min(u_radius,min(h.x,h.y));
float inset=-roundedRectSdf(p,h,r);float edge=smoothstep(-1.,.75,inset)*(1.-smoothstep(u_thickness,u_thickness+1.5,inset));
vec2 over=max(abs(p)-(h-r),0.);vec2 boundary=p;if(over.x>0.||over.y>0.){vec2 corner=sign(p)*(h-r);boundary=corner+normalize(max(abs(p)-(h-r),.0001))*r*sign(p);}
float edgeAngle=atan(boundary.y,boundary.x);float sweepAngle=u_time*u_auto+u_lightAngle;float diff=abs(atan(sin(edgeAngle-sweepAngle),cos(edgeAngle-sweepAngle)));
float band=1.-smoothstep(radians(u_shineSize),radians(u_shineSize+u_shineFade),diff);float shine=edge*band*u_focus*u_intensity;float base=edge*.2*u_focus;
vec3 color=mix(u_baseColor,u_lineColor,clamp(base+shine,0.,1.));color=mix(color,u_tint,u_tintOpacity);gl_FragColor=vec4(color,clamp(base+shine,0.,1.));}`;

function hexToRgb(hex) {
  const raw = String(hex || "").replace("#", "").trim();
  const value = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(value, 16);
  if (Number.isNaN(number)) return [1, 1, 1];
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

function shader(gl, type, source) {
  const item = gl.createShader(type);
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (gl.getShaderParameter(item, gl.COMPILE_STATUS)) return item;
  gl.deleteShader(item);
  return null;
}

function program(gl) {
  const vertex = shader(gl, gl.VERTEX_SHADER, VS);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FS);
  if (!vertex || !fragment) return null;
  const item = gl.createProgram();
  gl.attachShader(item, vertex);
  gl.attachShader(item, fragment);
  gl.linkProgram(item);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(item, gl.LINK_STATUS)) return item;
  gl.deleteProgram(item);
  return null;
}

function radiusFor(host, fallback) {
  const parsed = Number.parseFloat(window.getComputedStyle(host).borderTopLeftRadius);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function applySpecularButton(host, opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  if (!host || options.disabled) return { destroy() {} };
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true });
  if (!gl) return { destroy() {} };
  const shaderProgram = program(gl);
  if (!shaderProgram) return { destroy() {} };

  const previousPosition = host.style.position;
  if (window.getComputedStyle(host).position === "static") host.style.position = "relative";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "absolute", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", borderRadius: "inherit", zIndex: "2",
    filter: options.blur ? `blur(${options.blur}px)` : "",
  });
  host.appendChild(canvas);

  const buffer = gl.createBuffer();
  const loc = { position: gl.getAttribLocation(shaderProgram, "a_position") };
  [
    "resolution", "radius", "thickness", "time", "lightAngle", "focus", "auto",
    "intensity", "shineSize", "shineFade", "tintOpacity", "tint", "lineColor", "baseColor",
  ].forEach((name) => {
    loc[name] = gl.getUniformLocation(shaderProgram, `u_${name}`);
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.useProgram(shaderProgram);
  gl.enableVertexAttribArray(loc.position);
  gl.vertexAttribPointer(loc.position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform3fv(loc.tint, hexToRgb(options.tint));
  gl.uniform3fv(loc.lineColor, hexToRgb(options.lineColor));
  gl.uniform3fv(loc.baseColor, hexToRgb(options.baseColor));

  let raf = 0;
  let width = 0;
  let height = 0;
  let mouseX = -Infinity;
  let mouseY = -Infinity;
  let focus = options.autoAnimate ? 1 : 0;
  let destroyed = false;
  const resize = () => {
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height || SIZE_HEIGHTS[options.size] || SIZE_HEIGHTS.lg));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const onPointerMove = (event) => {
    ({ clientX: mouseX, clientY: mouseY } = event);
  };
  const onPointerLeave = () => {
    mouseX = -Infinity;
    mouseY = -Infinity;
  };
  const render = (now) => {
    if (destroyed) return;
    const rect = host.getBoundingClientRect();
    if (Math.round(rect.width) !== width || Math.round(rect.height) !== height) resize();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const distance = Math.hypot(mouseX - cx, mouseY - cy);
    const target = options.autoAnimate ? 1 : Math.max(0, 1 - distance / options.proximity);
    focus += (target - focus) * 0.12;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(shaderProgram);
    gl.uniform2f(loc.resolution, width, height);
    gl.uniform1f(loc.radius, Math.min(radiusFor(host, options.radius), width * 0.5, height * 0.5));
    gl.uniform1f(loc.thickness, Math.max(0.5, options.thickness));
    gl.uniform1f(loc.time, now * 0.001 * options.speed);
    gl.uniform1f(loc.lightAngle, options.followMouse && Number.isFinite(distance) ? Math.atan2(mouseY - cy, mouseX - cx) : 0);
    gl.uniform1f(loc.focus, focus);
    gl.uniform1f(loc.auto, options.autoAnimate ? 6.2831853 : 0);
    gl.uniform1f(loc.intensity, options.intensity);
    gl.uniform1f(loc.shineSize, options.shineSize);
    gl.uniform1f(loc.shineFade, options.shineFade);
    gl.uniform1f(loc.tintOpacity, options.tintOpacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = window.requestAnimationFrame(render);
  };

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  resize();
  observer?.observe(host);
  window.addEventListener("resize", resize);
  if (options.followMouse) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
  }
  raf = window.requestAnimationFrame(render);

  return {
    destroy() {
      destroyed = true;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      observer?.disconnect();
      canvas.remove();
      host.style.position = previousPosition;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(shaderProgram);
    },
  };
}

export function initSpecularButtons(root = document) {
  return Array.from(root.querySelectorAll("[data-specular]"), (host) => applySpecularButton(host));
}

if (typeof document !== "undefined") {
  const init = () => initSpecularButtons();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}

export default initSpecularButtons;
