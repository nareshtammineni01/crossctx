/**
 * gRPC Parser
 *
 * Parses .proto files to extract:
 *   - Service definitions and RPC methods
 *   - Message types used as request/response
 *
 * Detects gRPC client call patterns in source code:
 *   - Go:         grpc.Dial + stub.MethodName(ctx, req)
 *   - TypeScript: @GrpcMethod, @GrpcStreamMethod, client.getService()
 *   - Python:     stub.MethodName(request)
 *   - Java:       stub.methodName(request)
 *   - C#:         client.MethodName(request)
 */

import { readFile } from "fs/promises";
import fg from "fast-glob";
import type { OutboundCall, PayloadShape, SourceEndpoint } from "../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Proto file types
// ─────────────────────────────────────────────────────────────────────────────

export interface GrpcService {
  name: string;
  package: string;
  rpcs: GrpcRpc[];
  /** File the service was defined in */
  sourceFile: string;
}

export interface GrpcRpc {
  name: string;
  requestType: string;
  responseType: string;
  /** true if client-streaming */
  clientStreaming: boolean;
  /** true if server-streaming */
  serverStreaming: boolean;
}

export interface ProtoScanResult {
  services: GrpcService[];
  /** All message type names found in proto files */
  messageTypes: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proto file scanner + parser
// ─────────────────────────────────────────────────────────────────────────────

const PROTO_IGNORE = ["**/node_modules/**", "**/vendor/**", "**/.git/**"];

export async function scanProtoFiles(projectPath: string): Promise<ProtoScanResult> {
  const protoFiles = await fg(["**/*.proto"], {
    cwd: projectPath,
    ignore: PROTO_IGNORE,
    absolute: true,
    onlyFiles: true,
  });

  const services: GrpcService[] = [];
  const messageTypes = new Set<string>();

  for (const filePath of protoFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const { services: s, messageTypes: m } = parseProtoFile(content, filePath);
      services.push(...s);
      m.forEach((t) => messageTypes.add(t));
    } catch {
      /* skip unreadable */
    }
  }

  return { services, messageTypes };
}

function parseProtoFile(
  content: string,
  filePath: string,
): { services: GrpcService[]; messageTypes: Set<string> } {
  const services: GrpcService[] = [];
  const messageTypes = new Set<string>();

  // Extract package name
  const packageMatch = content.match(/^package\s+([\w.]+)\s*;/m);
  const pkg = packageMatch ? packageMatch[1] : "";

  // Extract message type names
  const messageRegex = /^message\s+(\w+)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = messageRegex.exec(content)) !== null) {
    messageTypes.add(m[1]);
  }

  // Extract services and their RPCs
  // service OrderService {
  //   rpc CreateOrder (CreateOrderRequest) returns (CreateOrderResponse);
  //   rpc ListOrders (stream ListOrdersRequest) returns (stream ListOrdersResponse);
  // }
  const serviceRegex = /service\s+(\w+)\s*\{([^}]+)\}/gs;
  while ((m = serviceRegex.exec(content)) !== null) {
    const serviceName = m[1];
    const serviceBody = m[2];

    const rpcs: GrpcRpc[] = [];

    const rpcRegex =
      /rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)/g;
    let rpcMatch: RegExpExecArray | null;

    while ((rpcMatch = rpcRegex.exec(serviceBody)) !== null) {
      rpcs.push({
        name: rpcMatch[1],
        clientStreaming: !!rpcMatch[2],
        requestType: rpcMatch[3],
        serverStreaming: !!rpcMatch[4],
        responseType: rpcMatch[5],
      });
    }

    services.push({ name: serviceName, package: pkg, rpcs, sourceFile: filePath });
  }

  return { services, messageTypes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert proto services to SourceEndpoints (for call chain integration)
// ─────────────────────────────────────────────────────────────────────────────

export function grpcServicesToEndpoints(
  services: GrpcService[],
  serviceName: string,
): SourceEndpoint[] {
  const endpoints: SourceEndpoint[] = [];

  for (const svc of services) {
    for (const rpc of svc.rpcs) {
      // Represent gRPC methods as "GRPC /PackageName.ServiceName/MethodName"
      const grpcPath = svc.package
        ? `/${svc.package}.${svc.name}/${rpc.name}`
        : `/${svc.name}/${rpc.name}`;

      endpoints.push({
        service: serviceName,
        method: "GRPC",
        path: grpcPath,
        fullPath: grpcPath,
        handlerMethod: rpc.name,
        summary: `${rpc.clientStreaming ? "stream " : ""}${rpc.requestType} → ${rpc.serverStreaming ? "stream " : ""}${rpc.responseType}`,
        requestBody: { typeName: rpc.requestType, fields: [], source: "dto-class" },
        response: { typeName: rpc.responseType, fields: [], source: "dto-class" },
        sourceFile: svc.sourceFile,
        outboundCalls: [],
      });
    }
  }

  return endpoints;
}

// ─────────────────────────────────────────────────────────────────────────────
// gRPC outbound call detection (per language)
// ─────────────────────────────────────────────────────────────────────────────

export function extractGrpcOutboundCalls(
  content: string,
  filePath: string,
  language: "go" | "typescript" | "python" | "java" | "csharp",
): OutboundCall[] {
  switch (language) {
    case "go":
      return extractGoGrpcCalls(content, filePath);
    case "typescript":
      return extractTsGrpcCalls(content, filePath);
    case "python":
      return extractPyGrpcCalls(content, filePath);
    case "java":
      return extractJavaGrpcCalls(content, filePath);
    case "csharp":
      return extractCsGrpcCalls(content, filePath);
    default:
      return [];
  }
}

function extractGoGrpcCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // grpc.Dial("order-service:50051", ...) or grpc.NewClient("order-service:50051", ...)
  const dialRegex = /grpc\.(?:Dial|NewClient)\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;

  while ((m = dialRegex.exec(content)) !== null) {
    const target = m[1];
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: target.startsWith("http") ? target : `grpc://${target}`,
      method: "GRPC",
      callPattern: "grpc-go",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.9,
    });
  }

  // Detect stub method calls: stub.CreateOrder(ctx, req) or ordersClient.GetOrder(ctx, req)
  // These appear after grpc.Dial — look for PascalCase method calls with ctx as first arg
  const stubCallRegex = /(\w+Client|\w+Stub|\w+stub)\s*\.\s*([A-Z]\w+)\s*\(\s*ctx/g;
  while ((m = stubCallRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    const methodName = m[2];
    // Emit as a named call — service resolution happens in resolver
    calls.push({
      rawUrl: `grpc-method://${m[1]}/${methodName}`,
      method: "GRPC",
      callPattern: "grpc-go-stub",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.75,
    });
  }

  return calls;
}

function extractTsGrpcCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // NestJS @GrpcMethod('ServiceName', 'MethodName') → this is a server handler
  // @GrpcStreamMethod is also server-side — we detect client calls instead

  // ClientGrpc: this.orderService = client.getService<OrderServiceClient>('OrderService')
  const getServiceRegex = /getService\s*<\w+>\s*\(\s*["'](\w+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = getServiceRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: `grpc-service://${m[1]}`,
      method: "GRPC",
      callPattern: "nestjs-grpc-client",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.8,
    });
  }

  // grpc.makeGenericClientConstructor or @grpc/grpc-js: new ServiceClient(address, ...)
  const clientCtorRegex = /new\s+(\w+(?:Client|ServiceClient|Stub))\s*\(\s*["']([^"']+)["']/g;
  while ((m = clientCtorRegex.exec(content)) !== null) {
    const target = m[2];
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: target.startsWith("http") ? target : `grpc://${target}`,
      method: "GRPC",
      callPattern: "grpc-js",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.85,
    });
  }

  return calls;
}

function extractPyGrpcCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // grpc.insecure_channel('order-service:50051') or grpc.secure_channel(...)
  const channelRegex = /grpc\.(?:insecure_channel|secure_channel)\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = channelRegex.exec(content)) !== null) {
    const target = m[1];
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: target.startsWith("http") ? target : `grpc://${target}`,
      method: "GRPC",
      callPattern: "grpcio",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.9,
    });
  }

  // stub = pb2_grpc.OrderServiceStub(channel)
  const stubRegex = /(\w+_grpc|_pb2_grpc)\.(\w+Stub)\s*\(\s*channel\s*\)/g;
  while ((m = stubRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: `grpc-service://${m[2].replace(/Stub$/, "")}`,
      method: "GRPC",
      callPattern: "grpcio-stub",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.8,
    });
  }

  return calls;
}

function extractJavaGrpcCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // ManagedChannelBuilder.forAddress("order-service", 50051) or forTarget("order-service:50051")
  const channelRegex = /ManagedChannelBuilder\.(?:forAddress|forTarget)\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = channelRegex.exec(content)) !== null) {
    const target = m[1];
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: target.startsWith("http") ? target : `grpc://${target}`,
      method: "GRPC",
      callPattern: "grpc-java",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.9,
    });
  }

  // OrderServiceGrpc.newBlockingStub(channel) or newFutureStub(channel)
  const stubRegex = /(\w+Grpc)\.new(?:Blocking|Future|Async)?Stub\s*\(/g;
  while ((m = stubRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    const serviceName = m[1].replace(/Grpc$/, "");
    calls.push({
      rawUrl: `grpc-service://${serviceName}`,
      method: "GRPC",
      callPattern: "grpc-java-stub",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.8,
    });
  }

  return calls;
}

function extractCsGrpcCalls(content: string, filePath: string): OutboundCall[] {
  const calls: OutboundCall[] = [];

  // GrpcChannel.ForAddress("http://order-service:50051") or new Channel("order-service", 50051, ...)
  const channelRegex =
    /(?:GrpcChannel\.ForAddress|new\s+Channel)\s*\(\s*["']([^"']+)["']\s*(?:,\s*(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = channelRegex.exec(content)) !== null) {
    const host = m[1];
    const port = m[2];
    const target = port ? `${host}:${port}` : host;
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: target.startsWith("http") ? target : `grpc://${target}`,
      method: "GRPC",
      callPattern: "grpc-dotnet",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.9,
    });
  }

  // new OrderService.OrderServiceClient(channel)
  const clientCtorRegex = /new\s+(\w+)\.(\w+Client)\s*\(/g;
  while ((m = clientCtorRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    calls.push({
      rawUrl: `grpc-service://${m[1]}`,
      method: "GRPC",
      callPattern: "grpc-dotnet-stub",
      sourceFile: filePath,
      line: lineNum,
      confidence: 0.75,
    });
  }

  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proto service → PayloadShape map
// ─────────────────────────────────────────────────────────────────────────────

export function buildProtoPayloadMap(result: ProtoScanResult): Map<string, PayloadShape> {
  const map = new Map<string, PayloadShape>();
  for (const typeName of result.messageTypes) {
    map.set(typeName, { typeName, fields: [], source: "dto-class" });
  }
  return map;
}
