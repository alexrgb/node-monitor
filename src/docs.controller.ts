import { Controller, Get } from '@nestjs/common';

@Controller('docs')
export class DocsController {
  @Get()
  getInfo() {
    // Fallback simple page if Swagger UI is not mounted in this runtime (e.g., in-memory E2E app)
    return {
      info: 'API documentation is available at this endpoint when Swagger UI is mounted in the main bootstrap.',
      try: ['/api-json', '/docs'],
    };
  }
}
