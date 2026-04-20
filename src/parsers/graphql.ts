/**
 * GraphQL Parser
 *
 * Parses .graphql / .gql schema files to extract:
 *   - Query and Mutation type definitions (treated as "endpoints")
 *   - Object types used as input/output
 *
 * Detects GraphQL client call patterns in source code:
 *   - TypeScript: Apollo Client, urql, graphql-request
 *   - Python:     gql, sgqlc, strawberry client
 *   - Go:         machinebox/graphql, Khan/genqlient
 *   - Java:       graphql-java client, Spring GraphQL
 */

import { readFile } from "fs/promises";
import fg from "fast-glob";
import type { OutboundCall, PayloadShape, SourceEndpoint } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL schema types
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphQLOperation {
  name: string;
  /** "Query" or "Mutation" or "Subscription" */
  operationType: "Query" | "Mutation" | "Subscription";
  inputType?: string;
  returnType?: string;
  sourceFile: string;
  line?: number;
}

export interface GraphQLSchemaScanResult {
  operations: GraphQLOperation[];
  /** All object type names found */
  typeNames: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema scanner + parser
// ─────────────────────────────────────────────────────────────────────────────

const GRAPHQL_IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"];

export async function scanGraphQLSchemas(projectPath: string): Promise<GraphQLSchemaScanResult> {
  const schemaFiles = await fg(["**/*.{graphql,gql}", "**/schema.{ts,js}"], {
    cwd: projectPath,
    ignore: GRAPHQL_IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  const allOperations: GraphQLOperation[] = [];
  const typeNames = new Set<string>();

  for (const filePath of schemaFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const { operations, typeNames: t } = parseGraphQLSchema(content, filePath);
      allOperations.push(...operations);
      t.forEach((name) => typeNames.add(name));
    } catch {
      /* skip */
    }
  }

  return { operations: allOperations, typeNames };
}

function parseGraphQLSchema(
  content: string,
  filePath: string,
): { operations: GraphQLOperation[]; typeNames: Set<string> } {
  const operations: GraphQLOperation[] = [];
  const typeNames = new Set<string>();
  // Collect all type names: type Foo { ... }  enum Bar { ... }  input Baz { ... }
  const typeRegex = /^(?:type|enum|input|interface|union)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = typeRegex.exec(content)) !== null) {
    typeNames.add(m[1]);
  }

  // Parse Query, Mutation, Subscription root types
  const rootTypeRegex =
    /^(?:type|extend type)\s+(Query|Mutation|Subscription)\s*(?:@\w+\s*)?\{([^}]+)\}/gms;

  while ((m = rootTypeRegex.exec(content)) !== null) {
    const opType = m[1] as "Query" | "Mutation" | "Subscription";
    const body = m[2];

    // Each field = one operation
    // createOrder(input: CreateOrderInput!): Order
    // orders(filter: OrderFilter, page: Int): [Order!]!
    // getUser(id: ID!): User
    const fieldRegex =
      /^\s+(\w+)\s*(?:\([^)]*(?::\s*(\w+)[!?\][\s]*)?[^)]*\))?\s*:\s*\[?(\w+)/gm;
    let fm: RegExpExecArray | null;

    while ((fm = fieldRegex.exec(body)) !== null) {
      const fieldName = fm[1];
      // Try to find input type from args
      const argsSection = fm[0];
      const inputMatch = argsSection.match(/:\s*(\w+Input)\b/);
      const returnType = fm[3];

      // Calculate approximate line number
      const bodyStartIdx = content.indexOf(m[2]);
      const fieldIdx = bodyStartIdx + fm.index;
      const lineNum = content.substring(0, fieldIdx).split("\n").length;

      operations.push({
        name: fieldName,
        operationType: opType,
        inputType: inputMatch ? inputMatch[1] : undefined,
        returnType,
        sourceFile: filePath,
        line: lineNum,
      });
    }
  }

  // Also handle TypeScript gql template literals: const QUERY = gql`...`
  if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
    const gqlRegex = /(?:gql|graphql)\s*`([^`]+)`/gs;
    while ((m = gqlRegex.exec(content)) !== null) {
      const gqlContent = m[1];
      const lineNum = content.substring(0, m.index).split("\n").length;

      // query GetUser($id: ID!) { ... } or mutation CreateOrder { ... }
      const opMatch = gqlContent.match(/(query|mutation|subscription)\s+(\w+)/i);
      if (opMatch) {
        operations.push({
          name: opMatch[2],
          operationType:
            opMatch[1].charAt(0).toUpperCase() + opMatch[1].slice(1).toLowerCase() as
              "Query" | "Mutation" | "Subscription",
          sourceFile: filePath,
          line: lineNum,
        });
      }
    }
  }

  return { operations, typeNames };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert GraphQL operations to SourceEndpoints
// ─────────────────────────────────────────────────────────────────────────────

export function graphqlOperationsToEndpoints(
  operations: GraphQLOperation[],
  serviceName: string,
): SourceEndpoint[] {
  return operations.map((op) => ({
    service: serviceName,
    method: op.operationType === "Query" ? "GRAPHQL_QUERY" : "GRAPHQL_MUTATION",
    path: `/graphql/${op.name}`,
    fullPath: `/graphql/${op.name}`,
    handlerMethod: op.name,
    summary: `${op.operationType}: ${op.name}`,
    requestBody: op.inputType ? { typeName: op.inputType, fields: [], source: "dto-class" as const } : undefined,
    response: op.returnType ? { typeName: op.returnType, fields: [], source: "dto-class" as const } : undefined,
    sourceFile: op.sourceFile,
    line: op.line,
    outboundCalls: [],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL outbound call detection (per language)
// ─────────────────────────────────────────────────────────────────────────────

export function extractGraphQLOutboundCalls(
  content: string,
  filePath: string,
  language: "typescript" | "python" | "go" | "java",
): OutboundCall[] {
  switch (language) {
    case "typescript":
      return extractTsGraphQLCalls(content, filePath);
    case "python":
      return extractPyGraphQLCalls(content, filePath);
    case "go":
      return extractGoGraphQLCalls(content, filePath);
    case "java":
      return extractJavaGraphQLCalls(content, filePath);
    default:
      return [];
  }
}

function extractTsGraphQLCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // Apollo Client: client.query({ query: GET_USERS }) or client.mutate({ mutation: CREATE_ORDER })
  const apolloQueryRegex = /client\.(query|mutate|subscribe)\s*\(\s*\{[^}]*?(query|mutation):\s*(\w+)/gs;
  let m: RegExpExecArray | null;
  while ((m = apolloQueryRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: `graphql-operation://${m[3]}`,
      method: m[1] === "mutate" ? "GRAPHQL_MUTATION" : "GRAPHQL_QUERY",
      callPattern: "apollo-client",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.8,
    });
  }

  // graphql-request: request(endpoint, query) or request(endpoint, MUTATION)
  const gqlRequestRegex =
    /(?:request|gql)\s*\(\s*["'`]([^"'`\n]+)["'`]\s*,\s*(\w+|`[^`]+`)/g;
  while ((m = gqlRequestRegex.exec(content)) !== null) {
    const endpoint = m[1];
    const lineNum = content.substring(0, m.index).split("\n").length;
    if (endpoint.startsWith("http") || endpoint.includes("/graphql")) {
      calls.push({
        rawUrl: endpoint,
        method: "GRAPHQL_QUERY",
        callPattern: "graphql-request",
        sourceFile: filePath,
        line: lineNum,
        confidence: endpoint.startsWith("http") ? 0.9 : 0.7,
      });
    }
  }

  // urql: useQuery({ query: GET_USERS }) or useMutation(CREATE_ORDER)
  const urqlRegex = /use(?:Query|Mutation)\s*\(\s*(?:\{[^}]*?(?:query|document):\s*)?(\w+)/g;
  while ((m = urqlRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: `graphql-operation://${m[1]}`,
      method: "GRAPHQL_QUERY",
      callPattern: "urql",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.7,
    });
  }

  return calls;
}

function extractPyGraphQLCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // gql library: client.execute(gql("""..."""))  or  session.execute(query)
  const gqlClientRegex = /(?:client|session)\.execute\s*\(\s*(?:gql\s*\()?["'`]{1,3}([^"'`]+)/gs;
  let m: RegExpExecArray | null;
  while ((m = gqlClientRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    const opMatch = m[1].match(/(query|mutation)\s+(\w+)/i);
    if (opMatch) {
      calls.push({
        rawUrl: `graphql-operation://${opMatch[2]}`,
        method: opMatch[1].toLowerCase() === "mutation" ? "GRAPHQL_MUTATION" : "GRAPHQL_QUERY",
        callPattern: "gql-python",
        sourceFile: filePath,
        line: lineNum,
        confidence: 0.8,
      });
    }
  }

  // requests.post with graphql endpoint
  const requestsGqlRegex =
    /requests\.post\s*\(\s*f?["']([^"'\n]*graphql[^"'\n]*)["']\s*,\s*json\s*=/g;
  while ((m = requestsGqlRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: m[1],
      method: "GRAPHQL_QUERY",
      callPattern: "requests-graphql",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.85,
    });
  }

  return calls;
}

function extractGoGraphQLCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // machinebox/graphql: graphql.NewClient("http://service/graphql")
  const clientRegex = /graphql\.NewClient\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = clientRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: m[1],
      method: "GRAPHQL_QUERY",
      callPattern: "machinebox-graphql",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.9,
    });
  }

  // client.Run(ctx, req, &resp) — Run = execute a GraphQL query
  const runRegex = /(\w+)\.Run\s*\(\s*ctx\s*,\s*(\w+)\s*,/g;
  while ((m = runRegex.exec(content)) !== null) {
    // Only emit if we already have a graphql client in this file
    if (content.includes("graphql.NewClient") || content.includes("genqlient")) {
      const lineNum = content.substring(0, m.index).split("\n").length;
      calls.push({
        rawUrl: `graphql-operation://${m[2]}`,
        method: "GRAPHQL_QUERY",
        callPattern: "graphql-go",
        sourceFile: filePath,
        line: lineNum,
        confidence: 0.65,
      });
    }
  }

  return calls;
}

function extractJavaGraphQLCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // Spring GraphQL: @QueryMapping, @MutationMapping (server handlers — not client calls)
  // Client: HttpGraphQlClient.builder("http://service/graphql").build()
  const httpClientRegex = /HttpGraphQlClient\.builder\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = httpClientRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: m[1],
      method: "GRAPHQL_QUERY",
      callPattern: "spring-graphql-client",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.9,
    });
  }

  // client.document("query { ... }").retrieve("operationName").toEntity(...)
  const clientDocRegex = /\.document\s*\(\s*["']([^"']+)["']/g;
  while ((m = clientDocRegex.exec(content)) !== null) {
    const opMatch = m[1].match(/(query|mutation)\s+(\w+)/i);
    if (opMatch) {
      const lineNum = content.substring(0, m.index).split("\n").length;
      calls.push({
        rawUrl: `graphql-operation://${opMatch[2]}`,
        method: opMatch[1].toLowerCase() === "mutation" ? "GRAPHQL_MUTATION" : "GRAPHQL_QUERY",
        callPattern: "spring-graphql-client",
        sourceFile: filePath,
        line: lineNum,
        confidence: 0.8,
      });
    }
  }

  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL type → PayloadShape map
// ─────────────────────────────────────────────────────────────────────────────

export function buildGraphQLPayloadMap(result: GraphQLSchemaScanResult): Map<string, PayloadShape> {
  const map = new Map<string, PayloadShape>();
  for (const typeName of result.typeNames) {
    map.set(typeName, { typeName, fields: [], source: "dto-class" });
  }
  return map;
}
