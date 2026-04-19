# Language and Framework Support

CrossCtx auto-detects the language and framework for each scanned directory. No configuration is needed.

---

## Supported Languages and Frameworks

| Language | Frameworks | Inbound Endpoints | Outbound Calls | DTO / Payload Extraction |
|----------|-----------|-------------------|----------------|--------------------------|
| **TypeScript** | NestJS, Express | ✅ | axios, fetch, HttpService, got | class-validator, Swagger decorators |
| **Java** | Spring Boot | ✅ | RestTemplate, WebClient, FeignClient | POJOs, records, Kotlin data classes |
| **C#** | ASP.NET Core | ✅ | HttpClient, IHttpClientFactory, Refit, RestSharp | Classes, positional records |
| **Python** | FastAPI, Django REST, Flask | ✅ | httpx, requests, aiohttp | Pydantic BaseModel, DRF Serializer, dataclass |
| **Go** | Gin, Chi | ✅ | net/http, go-resty | Struct fields |

---

## TypeScript / JavaScript

**Detection:** `package.json` with `@nestjs/core` (NestJS, confidence 0.98) or `express` (Express, confidence 0.92).

**Endpoint extraction:**
- `@Controller('path')` + `@Get()`, `@Post()`, `@Put()`, `@Delete()`, `@Patch()` decorators (NestJS)
- `router.get()`, `app.post()` etc. (Express)
- Route prefix from class-level `@Controller`

**Outbound call detection:**
- `axios.get()`, `axios.post()`, `axios.request()`
- `HttpService.get()`, `HttpService.post()` (NestJS)
- `fetch()`, `got()`
- Template literal URL construction: `` `${this.userServiceUrl}/api/users/${id}` ``

**DTO extraction:**
- TypeScript classes with `@ApiProperty()` (Swagger) or `class-validator` decorators
- Interface shapes with typed fields
- Inline object literals in method signatures

---

## Java / Spring Boot

**Detection:** `pom.xml` with `spring-boot` dependency (confidence 0.97).

**Endpoint extraction:**
- `@RestController` + `@RequestMapping` class prefix
- `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`
- `@PathVariable`, `@RequestParam`, `@RequestBody` parameter annotations

**Outbound call detection:**
- `RestTemplate.getForObject()`, `RestTemplate.postForObject()`, `RestTemplate.exchange()`
- `WebClient.get()`, `WebClient.post()`
- `@FeignClient("service-name")` — named client resolution at 0.95 confidence
- `LoadBalancerClient` with `lb://service-name` URLs

**DTO extraction:**
- Java classes with field declarations and getters
- Lombok `@Data` classes
- Java 16+ records
- Kotlin data classes (when mixed-language project)

**Message queues:**
- `@KafkaListener(topics = "...")` consumers
- `kafkaTemplate.send("topic", ...)` producers
- `@RabbitListener(queues = "...")` consumers
- `rabbitTemplate.convertAndSend(...)` producers

---

## C# / ASP.NET Core

**Detection:** `.csproj` file present (confidence 0.97).

**Endpoint extraction:**
- `[ApiController]` + `[Route("prefix")]` class attributes
- `[HttpGet]`, `[HttpPost]`, `[HttpPut]`, `[HttpDelete]`, `[HttpPatch]`
- `[Route("path")]` on individual action methods

**Outbound call detection:**
- `IHttpClientFactory.CreateClient("service-name")` — named client at 0.95
- `HttpClient.GetAsync()`, `HttpClient.PostAsync()`
- `Refit` interface declarations
- `RestSharp` client calls

**DTO extraction:**
- C# classes with public properties
- Positional records
- Nullable reference type annotations

---

## Python

**Detection:** `requirements.txt` or `pyproject.toml` with FastAPI/Django/Flask (confidence 0.95).

**Endpoint extraction:**
- FastAPI: `@app.get()`, `@router.post()`, `@router.put()` etc. with path parameters
- Django REST Framework: `ViewSet` methods, `@action` decorator, `urlpatterns`
- Flask: `@app.route()`, `@blueprint.route()`

**Outbound call detection:**
- `requests.get()`, `requests.post()`, `requests.request()`
- `httpx.get()`, `httpx.AsyncClient().post()`
- `aiohttp.ClientSession().get()`
- f-string URL construction: `f"{self.user_service_url}/api/users/{user_id}"`

**DTO extraction:**
- Pydantic `BaseModel` subclasses with field annotations
- Django REST `Serializer` classes
- Python `dataclass` definitions
- TypedDict declarations

---

## Go

**Detection:** `go.mod` with gin/chi imports (confidence 0.95).

**Endpoint extraction:**
- Gin: `router.GET()`, `router.POST()`, `r.Group()` with nested routes
- Chi: `r.Get()`, `r.Post()`, `r.Route()` groups

**Outbound call detection:**
- `http.Get()`, `http.Post()`, `http.NewRequest()`
- `resty.R().Get()`

**DTO extraction:**
- Struct field declarations with JSON tags
- `json:"field_name"` annotations

---

## OpenAPI / Swagger Spec Enrichment

In addition to source code parsing, CrossCtx scans for OpenAPI/Swagger spec files in the directories you provide:

- `openapi.json`, `openapi.yaml`, `openapi.yml`
- `swagger.json`, `swagger.yaml`
- `*.openapi.json`, `*.openapi.yml`

Both OpenAPI 3.x and Swagger 2.x are supported. Spec data enriches the source-code output — specs don't replace it.

---

## Message Queue Detection

Across all supported languages, CrossCtx detects message queue usage:

| System | Detection |
|--------|-----------|
| Kafka | `@KafkaListener`, `kafkaTemplate.send()`, `Consumer/Producer` |
| RabbitMQ | `@RabbitListener`, `rabbitTemplate.convertAndSend()` |
| AWS SQS | `SQS.sendMessage()`, `receiveMessage()` |
| Redis Pub/Sub | `redis.publish()`, `redis.subscribe()` |
| NATS | `nats.publish()`, `nats.subscribe()` |

---

## Planned Language Support

See [[Roadmap]] for upcoming additions including Ruby on Rails, gRPC, and GraphQL.

---

← [[AI Context Builder]] · [[Output Formats]] →
