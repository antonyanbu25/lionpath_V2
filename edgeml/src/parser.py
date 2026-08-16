from dataclasses import dataclass
from typing import Any

try:
    from .lexer import Lexer, Token, TokenType
except ImportError:
    from lexer import Lexer, Token, TokenType


class ASTNode:
    pass


@dataclass
class Program:
    declarations: list[ASTNode]


@dataclass
class TargetDecl(ASTNode):
    name: str
    arch: str
    simd: str
    ram: int
    align: int


@dataclass
class QuantScheme(ASTNode):
    name: str
    base: str
    block_size: int
    scale_type: str
    zero_type: str


@dataclass
class TensorDecl(ASTNode):
    storage_class: str
    name: str
    quant_type: str
    shape: list[Any]


@dataclass
class AttentionBlock(ASTNode):
    name: str
    kind: str
    heads: int
    head_dim: int
    rope_base: int
    decay: str
    beta: str
    state_dtype: str
    kv_heads: int = 1


@dataclass
class MoEBlock(ASTNode):
    name: str
    num_experts: int
    active: int
    router_dtype: str


@dataclass
class ModelDecl(ASTNode):
    name: str
    vocab: int
    d_model: int
    max_seq: int
    num_layers: int
    pipeline: list[Any]


class Parser:
    TYPE_TOKENS = {
        TokenType.MXFP4,
        TokenType.INT8,
        TokenType.INT4,
        TokenType.BF16,
        TokenType.FP16,
        TokenType.FP32,
    }

    def __init__(self, source: str):
        self.tokens = [
            tok for tok in Lexer(source).tokenize()
            if tok.type not in {TokenType.NEWLINE, TokenType.COMMENT}
        ]
        self.pos = 0

    def parse(self) -> Program:
        declarations: list[ASTNode] = []
        while self._peek().type != TokenType.EOF:
            token_type = self._peek().type
            if token_type == TokenType.TARGET:
                declarations.append(self._parse_target())
            elif token_type == TokenType.QUANTSCHEME:
                declarations.append(self._parse_quantscheme())
            elif token_type in {TokenType.WEIGHT, TokenType.STATE, TokenType.SCRATCH}:
                declarations.append(self._parse_tensor())
            elif token_type == TokenType.ATTENTION:
                declarations.append(self._parse_attention())
            elif token_type == TokenType.MOE:
                declarations.append(self._parse_moe())
            elif token_type == TokenType.MODEL:
                declarations.append(self._parse_model())
            elif token_type == TokenType.CONST:
                self._parse_const_decl()
            elif token_type == TokenType.LAYER:
                self._parse_layer_decl()
            elif token_type == TokenType.EXPORT:
                self._parse_export_decl()
            elif token_type == TokenType.IDENT:
                # Generic tensor decl: name: tensor<dtype, [shape]>;
                # parse as input/state by default
                name = self._advance().value
                self._expect(TokenType.COLON)
                self._expect(TokenType.TENSOR)
                self._expect(TokenType.LT)
                quant_type = self._parse_quant_ref()
                self._expect(TokenType.COMMA)
                shape = self._parse_shape()
                self._expect(TokenType.GT)
                self._expect(TokenType.SEMICOLON)
                declarations.append(TensorDecl("input", name, quant_type, shape))
            else:
                self._syntax_error(self._peek(), "top-level declaration")
        return Program(declarations)

    def _expect(self, token_type: TokenType) -> Token:
        token = self._peek()
        if token.type != token_type:
            self._syntax_error(token, token_type.name)
        return self._advance()

    def _peek(self) -> Token:
        return self.tokens[self.pos]

    def _advance(self):
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def _parse_target(self) -> TargetDecl:
        self._expect(TokenType.TARGET)
        name = self._expect(TokenType.IDENT).value
        self._expect(TokenType.LBRACE)
        fields: dict[str, Any] = {"arch": "", "simd": "", "ram": 0, "align": 0}
        while self._peek().type != TokenType.RBRACE:
            field = self._expect(TokenType.IDENT).value.lower()
            self._expect(TokenType.ASSIGN)
            if field == "arch":
                fields[field] = self._expect_one({TokenType.ARM64, TokenType.X86_64, TokenType.GENERIC}, "architecture").value
            elif field == "simd":
                token = self._expect_one({TokenType.NEON, TokenType.AVX2, TokenType.IDENT}, "simd")
                fields[field] = token.value
            elif field == "ram":
                fields[field] = self._mem_to_bytes(self._expect(TokenType.MEM_LITERAL).value)
            elif field == "align":
                fields[field] = int(self._expect(TokenType.INT).value)
            else:
                self._syntax_error(self._peek(), "target field")
            self._expect(TokenType.SEMICOLON)
        self._expect(TokenType.RBRACE)
        return TargetDecl(name, fields["arch"], fields["simd"], fields["ram"], fields["align"])

    def _parse_const_decl(self):
        self._expect(TokenType.CONST)
        self._expect(TokenType.IDENT)
        self._expect(TokenType.ASSIGN)
        self._skip_until(TokenType.SEMICOLON)
        self._expect(TokenType.SEMICOLON)

    def _parse_quantscheme(self) -> QuantScheme:
        self._expect(TokenType.QUANTSCHEME)
        name = self._expect(TokenType.IDENT).value
        self._expect(TokenType.ASSIGN)
        quant = self._parse_quant_type()
        self._expect(TokenType.SEMICOLON)
        return QuantScheme(
            name=name,
            base=quant["base"],
            block_size=quant.get("block_size", 0),
            scale_type=quant.get("scale_type", ""),
            zero_type=quant.get("zero_type", ""),
        )

    def _parse_tensor(self) -> TensorDecl:
        storage_class = self._advance().value.lower()
        name = self._expect(TokenType.IDENT).value
        self._expect(TokenType.COLON)
        self._expect(TokenType.TENSOR)
        self._expect(TokenType.LT)
        quant_type = self._parse_quant_ref()
        self._expect(TokenType.COMMA)
        shape = self._parse_shape()
        self._expect(TokenType.GT)
        self._expect(TokenType.SEMICOLON)
        return TensorDecl(storage_class, name, quant_type, shape)

    def _parse_layer_decl(self):
        self._expect(TokenType.LAYER)
        self._expect(TokenType.IDENT)
        self._skip_optional_params()
        self._expect(TokenType.LBRACE)
        depth = 1
        while depth and self._peek().type != TokenType.EOF:
            tok = self._advance()
            if tok.type == TokenType.LBRACE:
                depth += 1
            elif tok.type == TokenType.RBRACE:
                depth -= 1

    def _parse_attention(self) -> AttentionBlock:
        self._expect(TokenType.ATTENTION)
        name = self._expect(TokenType.IDENT).value
        self._skip_optional_params()
        self._expect(TokenType.LBRACE)
        fields: dict[str, Any] = {
            "kind": "",
            "heads": 0,
            "head_dim": 0,
            "rope_base": 0,
            "decay": "",
            "beta": "",
            "state_dtype": "",
            "kv_heads": 1,
        }
        while self._peek().type != TokenType.RBRACE:
            if self._peek().type in {TokenType.WEIGHT, TokenType.STATE, TokenType.SCRATCH}:
                self._parse_tensor()
            elif self._peek().type == TokenType.IDENT:
                key = self._advance().value
                if self._peek().type != TokenType.ASSIGN:
                    self._skip_statement_or_block()
                    continue
                self._expect(TokenType.ASSIGN)
                self._parse_attention_field_value(key, fields)
                self._expect(TokenType.SEMICOLON)
            else:
                self._skip_statement_or_block()
        self._expect(TokenType.RBRACE)
        return AttentionBlock(
            name,
            fields["kind"],
            fields["heads"],
            fields["head_dim"],
            fields["rope_base"],
            fields["decay"],
            fields["beta"],
            fields["state_dtype"],
            fields["kv_heads"],
        )

    def _parse_moe(self) -> MoEBlock:
        self._expect(TokenType.MOE)
        name = self._expect(TokenType.IDENT).value
        self._skip_optional_params()
        self._expect(TokenType.LBRACE)
        fields: dict[str, Any] = {"experts": 0, "active": 0, "router_dtype": ""}
        while self._peek().type != TokenType.RBRACE:
            if self._peek().type in {TokenType.WEIGHT, TokenType.STATE, TokenType.SCRATCH}:
                self._parse_tensor()
            elif self._peek().type == TokenType.IDENT:
                key = self._advance().value
                if self._peek().type != TokenType.ASSIGN:
                    self._skip_statement_or_block()
                    continue
                self._expect(TokenType.ASSIGN)
                if key == "experts":
                    fields["experts"] = self._parse_const_expr()
                elif key == "active":
                    fields["active"] = self._parse_const_expr()
                elif key == "router_dtype":
                    fields["router_dtype"] = self._parse_quant_ref()
                else:
                    self._skip_until(TokenType.SEMICOLON)
                self._expect(TokenType.SEMICOLON)
            else:
                self._skip_statement_or_block()
        self._expect(TokenType.RBRACE)
        return MoEBlock(name, fields["experts"], fields["active"], fields["router_dtype"])

    def _parse_model(self) -> ModelDecl:
        self._expect(TokenType.MODEL)
        name = self._expect(TokenType.IDENT).value
        self._expect(TokenType.LBRACE)
        fields: dict[str, Any] = {"vocab": 0, "d_model": 0, "max_seq": 0, "layers": 0}
        pipeline: list[Any] = []
        while self._peek().type != TokenType.RBRACE:
            if self._peek().type in {TokenType.WEIGHT, TokenType.STATE, TokenType.SCRATCH}:
                self._parse_tensor()
            elif self._peek().type == TokenType.IDENT and self._peek().value.lower() == "pipeline":
                pipeline = self._parse_pipeline()
            elif self._peek().type == TokenType.IDENT:
                key = self._advance().value
                self._expect(TokenType.ASSIGN)
                if key in fields:
                    fields[key] = self._parse_const_expr()
                else:
                    self._skip_until(TokenType.SEMICOLON)
                self._expect(TokenType.SEMICOLON)
            else:
                self._skip_statement_or_block()
        self._expect(TokenType.RBRACE)
        return ModelDecl(name, fields["vocab"], fields["d_model"], fields["max_seq"], fields["layers"], pipeline)

    def _parse_export_decl(self):
        self._expect(TokenType.EXPORT)
        self._expect(TokenType.IDENT)
        token = self._peek()
        if token.type != TokenType.IDENT or token.value.lower() != "for":
            self._syntax_error(token, "for")
        self._advance()
        self._expect(TokenType.IDENT)
        self._expect(TokenType.SEMICOLON)

    def _parse_quant_type(self) -> dict[str, Any]:
        base = self._expect_one(self.TYPE_TOKENS, "quant base type").value
        quant: dict[str, Any] = {"base": base}
        if self._peek().type == TokenType.LBRACKET:
            self._advance()
            while self._peek().type != TokenType.RBRACKET:
                key = self._advance()
                self._expect(TokenType.ASSIGN)
                if key.type == TokenType.BLOCK:
                    quant["block_size"] = int(self._expect(TokenType.INT).value)
                elif key.type == TokenType.SCALE:
                    quant["scale_type"] = self._expect_one(self.TYPE_TOKENS | {TokenType.IDENT}, "scale type").value
                elif key.type == TokenType.ZERO:
                    quant["zero_type"] = self._expect_one({TokenType.SYM, TokenType.ASYM}, "zero type").value
                else:
                    self._syntax_error(key, "quant parameter")
                if self._peek().type == TokenType.COMMA:
                    self._advance()
                else:
                    break
            self._expect(TokenType.RBRACKET)
        return quant

    def _parse_quant_ref(self) -> str:
        if self._peek().type in self.TYPE_TOKENS:
            quant = self._parse_quant_type()
            if any(key in quant for key in ("block_size", "scale_type", "zero_type")):
                params = []
                if "block_size" in quant:
                    params.append(f"block={quant['block_size']}")
                if "scale_type" in quant:
                    params.append(f"scale={quant['scale_type']}")
                if "zero_type" in quant:
                    params.append(f"zero={quant['zero_type']}")
                return f"{quant['base']}[{', '.join(params)}]"
            return quant["base"]
        return self._expect(TokenType.IDENT).value

    def _parse_shape(self) -> list[Any]:
        shape: list[Any] = []
        self._expect(TokenType.LBRACKET)
        while self._peek().type != TokenType.RBRACKET:
            if self._peek().type == TokenType.QUESTION:
                self._advance()
                shape.append("?")
            else:
                shape.append(self._parse_const_expr())
            if self._peek().type == TokenType.COMMA:
                self._advance()
            else:
                break
        self._expect(TokenType.RBRACKET)
        return shape

    def _parse_const_expr(self) -> Any:
        parts = []
        depth = 0
        while True:
            tok = self._peek()
            if tok.type in {TokenType.SEMICOLON, TokenType.COMMA, TokenType.RBRACKET, TokenType.RPAREN} and depth == 0:
                break
            if tok.type == TokenType.LPAREN:
                depth += 1
            elif tok.type == TokenType.RPAREN:
                depth -= 1
            parts.append(self._advance().value)
        if len(parts) == 1 and re_int(parts[0]):
            return int(parts[0])
        return " ".join(parts)

    def _parse_attention_field_value(self, key: str, fields: dict[str, Any]):
        if key == "kind":
            fields[key] = self._expect_one({TokenType.KDA, TokenType.MHA, TokenType.GQA}, "attention kind").value
        elif key in {"heads", "head_dim", "kv_heads"}:
            fields[key] = self._parse_const_expr()
        elif key == "rope_base":
            fields[key] = int(self._expect(TokenType.INT).value)
        elif key in {"decay", "beta"}:
            fields[key] = self._expect_one({TokenType.LEARNED, TokenType.FIXED}, key).value
        elif key == "state_dtype":
            fields[key] = self._parse_quant_ref()
        else:
            self._skip_until(TokenType.SEMICOLON)

    def _parse_pipeline(self) -> list[Any]:
        self._expect(TokenType.IDENT)
        self._expect(TokenType.LBRACE)
        start = self.pos
        depth = 1
        while depth and self._peek().type != TokenType.EOF:
            tok = self._advance()
            if tok.type == TokenType.LBRACE:
                depth += 1
            elif tok.type == TokenType.RBRACE:
                depth -= 1
        return [tok.value for tok in self.tokens[start:self.pos - 1]]

    def _skip_optional_params(self):
        if self._peek().type != TokenType.LPAREN:
            return
        depth = 0
        while self._peek().type != TokenType.EOF:
            tok = self._advance()
            if tok.type == TokenType.LPAREN:
                depth += 1
            elif tok.type == TokenType.RPAREN:
                depth -= 1
                if depth == 0:
                    return

    def _skip_statement_or_block(self):
        if self._peek().type == TokenType.LBRACE:
            self._skip_block()
        else:
            self._skip_until(TokenType.SEMICOLON)
            if self._peek().type == TokenType.SEMICOLON:
                self._advance()

    def _skip_block(self):
        depth = 0
        while self._peek().type != TokenType.EOF:
            tok = self._advance()
            if tok.type == TokenType.LBRACE:
                depth += 1
            elif tok.type == TokenType.RBRACE:
                depth -= 1
                if depth == 0:
                    return

    def _skip_until(self, token_type: TokenType):
        while self._peek().type not in {token_type, TokenType.EOF}:
            self._advance()

    def _expect_one(self, token_types: set[TokenType], expected: str) -> Token:
        token = self._peek()
        if token.type not in token_types:
            self._syntax_error(token, expected)
        return self._advance()

    def _mem_to_bytes(self, value: str) -> int:
        units = {"B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}
        for unit, multiplier in sorted(units.items(), key=lambda item: -len(item[0])):
            if value.endswith(unit):
                return int(value[:-len(unit)]) * multiplier
        self._syntax_error(self._peek(), "memory literal")

    def _syntax_error(self, token: Token, expected: str):
        raise SyntaxError(f"Unexpected {token}, expected {expected} at line {token.line}")


def re_int(value: str) -> bool:
    return value.isdigit()
