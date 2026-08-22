/**
 * Editing a field that arrived with a value.
 *
 * The formatting tests cover an empty field being filled. What broke in the
 * browser was the other case: a budget sheet seeded with ₹1,20,00,000, where
 * clearing the box put the old number straight back and every keystroke after
 * that landed inside text the user had already deleted — ₹1,20,00,000 became
 * ₹1,23,45,61,20,00,000 in eight keystrokes.
 *
 * The cause was a parent that does not accept what it is handed: a schema
 * carrying `.default(0)`, a coercion, a debounce. So these use a parent that
 * deliberately refuses, which is the only reliable way to keep the fix honest.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MoneyInput } from "./money-input";

afterEach(cleanup);

/** A parent that never changes its mind — the shape that caused the bug. */
function StubbornParent({ pinned, onEmit }: { pinned: number; onEmit: (p: number | null) => void }) {
  const [, force] = React.useState(0);
  return (
    <MoneyInput
      aria-label="Budget"
      value={pinned}
      onValueChange={(paise) => {
        onEmit(paise);
        force((n) => n + 1); // re-render, still holding `pinned`
      }}
    />
  );
}

const typeInto = (input: HTMLInputElement, chars: string) => {
  for (const ch of chars) {
    fireEvent.change(input, { target: { value: input.value + ch } });
  }
};

describe("a money field that arrived with a value", () => {
  it("can be cleared, even by a parent that refuses the change", () => {
    const onEmit = vi.fn();
    render(<StubbornParent pinned={1_20_00_000_00} onEmit={onEmit} />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    expect(input.value).toBe("1,20,00,000");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    expect(input.value).toBe("");
    expect(onEmit).toHaveBeenCalledWith(null);
  });

  it("keeps every keystroke of a retype instead of stacking them on the old value", () => {
    render(<StubbornParent pinned={1_20_00_000_00} onEmit={() => {}} />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    typeInto(input, "12345678");

    expect(input.value).toBe("1,23,45,678");
  });

  it("shows what the form actually holds once focus leaves", () => {
    render(<StubbornParent pinned={1_20_00_000_00} onEmit={() => {}} />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    typeInto(input, "999");
    expect(input.value).toBe("999");

    // The parent refused it. Saying so on blur is honest; leaving "999" on
    // screen next to a stored ₹1,20,00,000 would not be.
    fireEvent.blur(input);
    expect(input.value).toBe("1,20,00,000");
  });

  it("still adopts an external change when the user is not in the field", () => {
    function Reseeded() {
      const [paise, setPaise] = React.useState(500_00);
      return (
        <>
          <MoneyInput aria-label="Budget" value={paise} onValueChange={() => {}} />
          <button onClick={() => setPaise(7_50_000_00)}>load</button>
        </>
      );
    }
    render(<Reseeded />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    expect(input.value).toBe("500");
    fireEvent.click(screen.getByText("load"));
    expect(input.value).toBe("7,50,000");
  });

  it("does not fight a parent that accepts the value", () => {
    function Normal() {
      const [paise, setPaise] = React.useState<number | null>(1_20_00_000_00);
      return <MoneyInput aria-label="Budget" value={paise} onValueChange={setPaise} />;
    }
    render(<Normal />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    typeInto(input, "2500000");
    fireEvent.blur(input);
    expect(input.value).toBe("25,00,000");
  });
});
