/**
 * A money field that looks labelled and is not.
 *
 * `Field` associates its label by cloning its child with an id, which works for
 * `<Field><MoneyInput/></Field>` and silently does nothing for
 * `<Field><Controller render={() => <MoneyInput/>}/></Field>` — the shape
 * react-hook-form pushes people towards, and the shape four converted money
 * fields ended up in. Nothing looked wrong on screen; the input simply had no
 * accessible name. These pin both shapes.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Field } from "./field";
import { MoneyInput, RupeeInput } from "./money-input";

afterEach(cleanup);

describe("a money input inside a Field", () => {
  it("is named by its label as a direct child", () => {
    render(
      <Field label="Amount">
        <MoneyInput value={null} onValueChange={() => {}} />
      </Field>,
    );
    expect(screen.getByLabelText("Amount")).toBeTruthy();
  });

  it("is named by its label when nested inside a render prop", () => {
    // Stands in for <Controller render={() => …}/>: a component that renders
    // the control but never forwards what Field cloned onto it.
    const Nested = ({ children }: { children: () => React.ReactNode }) => <>{children()}</>;
    render(
      <Field label="Advance amount">
        <Nested>{() => <MoneyInput value={null} onValueChange={() => {}} />}</Nested>
      </Field>,
    );
    expect(screen.getByLabelText("Advance amount")).toBeTruthy();
  });

  it("carries the field's error to the control, nested or not", () => {
    const Nested = ({ children }: { children: () => React.ReactNode }) => <>{children()}</>;
    render(
      <Field label="Payment" error="Enter an amount">
        <Nested>{() => <MoneyInput value={null} onValueChange={() => {}} />}</Nested>
      </Field>,
    );
    const input = screen.getByLabelText("Payment");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // The message is announced with the field, not just painted under it.
    expect(input.getAttribute("aria-describedby")).toContain("-error");
  });

  it("still says which currency, since the ₹ glyph is decorative", () => {
    render(
      <Field label="Amount">
        <MoneyInput value={null} onValueChange={() => {}} />
      </Field>,
    );
    const input = screen.getByLabelText("Amount");
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const said = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(said).toMatch(/Indian rupees/i);
  });

  it("lets an explicit id or label win over the field's", () => {
    render(
      <Field label="Range">
        <MoneyInput value={null} onValueChange={() => {}} aria-label="Minimum amount" />
      </Field>,
    );
    expect(screen.getByLabelText("Minimum amount")).toBeTruthy();
  });

  it("applies to the rupee-schema variant too", () => {
    const Nested = ({ children }: { children: () => React.ReactNode }) => <>{children()}</>;
    render(
      <Field label="Total project budget">
        <Nested>{() => <RupeeInput value={undefined} onValueChange={() => {}} />}</Nested>
      </Field>,
    );
    expect(screen.getByLabelText("Total project budget")).toBeTruthy();
  });
});
