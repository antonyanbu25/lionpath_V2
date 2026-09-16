import { readFieldValue, readFieldValueAsync, syncFieldValueFromShadow } from "../crayons-ui.js";

function mockTextarea({ sync = "", getValue = "" }) {
  return {
    tagName: "FW-TEXTAREA",
    value: sync,
    shadowRoot: sync ? null : { querySelector: () => ({ value: "" }) },
    getValue: async () => getValue,
  };
}

function mockInput({ sync = "", getValue = "" }) {
  return {
    tagName: "FW-INPUT",
    value: sync,
    shadowRoot: null,
    getValue: async () => getValue,
  };
}

const checks = [
  [
    "textarea prefers getValue when sync empty",
    async () => {
      const el = mockTextarea({ sync: "", getValue: "Uses Zendesk, 50 agents" });
      return (await readFieldValueAsync(el)) === "Uses Zendesk, 50 agents";
    },
  ],
  [
    "textarea uses sync when getValue empty",
    async () => {
      const el = mockTextarea({ sync: "From host", getValue: "" });
      return (await readFieldValueAsync(el)) === "From host";
    },
  ],
  [
    "input prefers sync over getValue",
    async () => {
      const el = mockInput({ sync: "host wins", getValue: "async loses" });
      return (await readFieldValueAsync(el)) === "host wins";
    },
  ],
  [
    "readFieldValue reads shadow textarea",
    () => {
      const el = {
        value: "",
        shadowRoot: { querySelector: () => ({ value: "shadow text" }) },
      };
      return readFieldValue(el) === "shadow text";
    },
  ],
  [
    "syncFieldValueFromShadow promotes shadow value to host",
    () => {
      const el = {
        tagName: "FW-INPUT",
        value: "",
        shadowRoot: { querySelector: () => ({ value: "simon@wildfawnjewellery.com" }) },
      };
      syncFieldValueFromShadow(el);
      return el.value === "simon@wildfawnjewellery.com";
    },
  ],
  [
    "readFieldValueAsync prefers shadow after host empty on fw-input",
    async () => {
      const el = {
        tagName: "FW-INPUT",
        value: "",
        shadowRoot: { querySelector: () => ({ value: "alex@acme.com" }) },
        getValue: async () => "",
      };
      syncFieldValueFromShadow(el);
      return (await readFieldValueAsync(el)) === "alex@acme.com";
    },
  ],
];

let failed = 0;
for (const [name, fn] of checks) {
  const ok = await fn();
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} crayons-ui checks passed.`);
