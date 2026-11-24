// The Secrets section and the Variables section over stores filled by hand: the secret form (a name the dotenv rule
// refuses, a value never echoed nor kept once set, the form kept when the set was refused), which cells read each
// secret; the Variables section's own line when the scope cannot be read.
import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspaceStore } from "../store/workspace.js";
import { cellOf, mountPanel, showNotebook } from "../fixtures/panels.js";
import SecretsSection from "./SecretsSection.vue";
import VariablesSection from "./VariablesSection.vue";

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

const secretsWith = (answer: unknown, live = true) => {
  showNotebook(
    [
      cellOf("c_1", "env.API_KEY + env.API_KEY"),
      cellOf("c_2", "# env.API_KEY", { type: "markdown" }),
      cellOf("c_3", 'env["API_KEY"] + env.ONE'),
    ],
    [],
    live,
  );
  useWorkspaceStore().secrets = ["API_KEY", "ONE", "OTHER"];
  return mountPanel(SecretsSection, { answer });
};
const add = 'button[aria-label="Add secret"]';

describe("SecretsSection", () => {
  it("says which cells read each secret", () => {
    const { wrapper } = secretsWith({});
    expect(wrapper.findAll('ul[aria-label="Secrets"] li').map((li) => li.text())).toEqual([
      "API_KEYcells 1, 3 Edit",
      "ONEcell 3 Edit",
      "OTHERunused Edit",
    ]);
  });

  it("sets one through the form, refusing a name the dotenv rule refuses", async () => {
    const { wrapper, calls } = secretsWith({});
    await wrapper.get(add).trigger("click");
    expect(document.activeElement).toBe(wrapper.get("#secret-name").element);
    expect(wrapper.get("form").text()).toContain("New secret");
    await wrapper.get("#secret-name").setValue("bad name");
    expect(wrapper.text()).toContain("A-Z, 0-9 and _, starting with a letter");
    expect(wrapper.get("#secret-name").attributes("aria-invalid")).toBe("true");
    await wrapper.get("#secret-value").setValue("s3cret");
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.get("form").trigger("submit");
    expect(calls).toEqual([]);
    await wrapper.get("#secret-name").setValue("NEW_KEY");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(calls).toEqual([["ui.secrets.set", { name: "NEW_KEY", value: "s3cret" }]]);
    expect(wrapper.find("form").exists()).toBe(false);
  });
});

describe("SecretsSection's value", () => {
  it("never echoes the value: a password field, nothing of it in the page, forgotten once set", async () => {
    const { wrapper } = secretsWith({});
    await wrapper.get(add).trigger("click");
    await wrapper.get("#secret-name").setValue("NEW_KEY");
    await wrapper.get("#secret-value").setValue("s3cret");
    expect(wrapper.get("#secret-value").attributes()).toMatchObject({
      type: "password",
      autocomplete: "new-password",
    });
    expect(wrapper.html()).not.toContain("s3cret");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    await wrapper.get(add).trigger("click");
    expect(wrapper.get<HTMLInputElement>("#secret-value").element.value).toBe("");
    expect(wrapper.html()).not.toContain("s3cret");
  });
});

describe("SecretsSection's Edit", () => {
  it("opens the form on the secret's name with an empty value, and does not send an empty one", async () => {
    const { wrapper, calls } = secretsWith({});
    await wrapper.get('button[aria-label="Edit API_KEY"]').trigger("click");
    expect(wrapper.get("form").text()).toContain("New value for API_KEY");
    expect(wrapper.get<HTMLInputElement>("#secret-name").element.value).toBe("API_KEY");
    expect(document.activeElement).toBe(wrapper.get("#secret-value").element);
    await wrapper.get("form").trigger("submit");
    expect(calls).toEqual([]);
  });

  it("keeps the form when the set was refused, and forgets the value on Cancel and on Esc", async () => {
    const { wrapper } = secretsWith(undefined);
    await wrapper.get('button[aria-label="Edit API_KEY"]').trigger("click");
    await wrapper.get("#secret-value").setValue("v");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>("#secret-value").element.value).toBe("v");
    await wrapper.get('form button[type="button"]').trigger("click");
    expect(wrapper.find("form").exists()).toBe(false);
    await wrapper.get(add).trigger("click");
    expect(wrapper.get<HTMLInputElement>("#secret-value").element.value).toBe("");
    await wrapper.get("#secret-value").setValue("w");
    await wrapper.get("form").trigger("keydown", { key: "Escape" });
    await wrapper.get(add).trigger("click");
    expect(wrapper.get<HTMLInputElement>("#secret-value").element.value).toBe("");
  });

  it("is off in a view-only tab", () => {
    const viewOnly = secretsWith({}, false).wrapper;
    expect(viewOnly.get(add).attributes("disabled")).toBeDefined();
    expect(viewOnly.get('button[aria-label="Edit ONE"]').attributes("disabled")).toBeDefined();
  });
});

describe("VariablesSection", () => {
  it("says why the scope could not be read", async () => {
    showNotebook([]);
    const { wrapper } = mountPanel(VariablesSection);
    await flushPromises();
    expect(wrapper.get('[data-testid="scope-failed"]').text()).not.toBe("");
    expect(wrapper.find('ul[aria-label="Variables"]').exists()).toBe(false);
  });
});
