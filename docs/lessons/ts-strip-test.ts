const names = ["Alice", "Bob", "Charlie"];

const row = ["ada", 2];
const modes = ["read", "write"] as const;

type Mode = (typeof modes)[number]; 


const mode: Mode = "read"; // Valid

const original = [{ value: 1 }]
const copied = [...original]

console.log(copied)

copied[0].value = 2;
console.log(original)
type Action = { type: "add"; value: number } | { type: "clear" } | { type: "multiply"; value: number };


function apply(current: number, action: Action): number {
  switch (action.type) {
    case "add":
      return current + action.value;
    case "clear":
      return 0;
    case "multiply":
      return current * action.value;
    default: {
      const impossible: never = action;
      return impossible;
    }
  }
}

const c = apply(10, { type: "multiply", value: 5 }); // Returns 15
console.log(c)