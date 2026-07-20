/**
 * Transforms a JSON Schema into llama.cpp strict-mode compatible form.
 * Strict mode requires:
 * - All `type: "object"` nodes have `additionalProperties: false`
 * - All declared properties appear in the `required` array
 * - Optional properties get nullable types so the model can emit null
 */
export function toStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return walkNode(structuredClone(schema));
}

function walkNode(node: Record<string, unknown>): Record<string, unknown> {
  if (typeof node !== "object" || node === null) return node;

  const type = node.type as string | string[] | undefined;

  if (type === "object" || (typeof type === "undefined" && node.properties)) {
    if (!node.type) node.type = "object";
    const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      const existingRequired = new Set(
        Array.isArray(node.required) ? (node.required as string[]) : []
      );
      const allKeys = Object.keys(properties);

      for (const key of allKeys) {
        properties[key] = walkNode(properties[key]);
        if (!existingRequired.has(key)) {
          properties[key] = makeNullable(properties[key]);
        }
      }

      node.required = allKeys;
      node.additionalProperties = false;
    }
  }

  if (type === "array" && node.items) {
    node.items = walkNode(node.items as Record<string, unknown>);
  }

  return node;
}

function makeNullable(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema.type;
  if (!type) return schema;

  if (Array.isArray(type)) {
    if (!type.includes("null")) {
      schema.type = [...type, "null"];
    }
  } else if (typeof type === "string" && type !== "null") {
    schema.type = [type, "null"];
  }

  return schema;
}
