import external from "../../../../../../packages/contracts/openapi/external.json";

export const prerender = true;

export function GET(): Response {
  return new Response(`${JSON.stringify(external, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kinship-openapi.json"',
    },
  });
}
