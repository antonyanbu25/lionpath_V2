import re
from dataclasses import dataclass
from enum import Enum, auto


class TokenType(Enum):
    # Keywords
    TARGET = auto(); CONST = auto(); QUANTSCHEME = auto(); WEIGHT = auto()
    STATE = auto(); SCRATCH = auto(); LAYER = auto(); ATTENTION = auto()
    MOE = auto(); MODEL = auto(); EXPORT = auto(); TENSOR = auto()
    # Types
    MXFP4 = auto(); INT8 = auto(); INT4 = auto(); BF16 = auto(); FP16 = auto(); FP32 = auto()
    # Quant params
    BLOCK = auto(); SCALE = auto(); ZERO = auto(); SYM = auto(); ASYM = auto()
    # Architecture
    ARM64 = auto(); X86_64 = auto(); GENERIC = auto(); NEON = auto(); AVX2 = auto()
    # KDA
    KDA = auto(); MHA = auto(); GQA = auto(); LEARNED = auto(); FIXED = auto()
    # Literals
    IDENT = auto(); INT = auto(); STRING = auto(); MEM_LITERAL = auto()
    # Operators
    LBRACKET = auto(); RBRACKET = auto(); LBRACE = auto(); RBRACE = auto()
    LPAREN = auto(); RPAREN = auto(); SEMICOLON = auto(); COMMA = auto()
    ASSIGN = auto(); PLUS = auto(); MINUS = auto(); STAR = auto(); SLASH = auto()
    AT = auto()  # matmul
    # Extra grammar punctuation/operators
    COLON = auto(); LT = auto(); GT = auto(); QUESTION = auto(); PERCENT = auto()
    # Special
    EOF = auto(); NEWLINE = auto(); COMMENT = auto(); UNKNOWN = auto()


@dataclass
class Token:
    type: TokenType
    value: str
    line: int
    col: int


class Lexer:
    KEYWORDS = {
        "target": TokenType.TARGET,
        "const": TokenType.CONST,
        "quantscheme": TokenType.QUANTSCHEME,
        "weight": TokenType.WEIGHT,
        "state": TokenType.STATE,
        "scratch": TokenType.SCRATCH,
        "layer": TokenType.LAYER,
        "attention": TokenType.ATTENTION,
        "moe": TokenType.MOE,
        "model": TokenType.MODEL,
        "export": TokenType.EXPORT,
        "tensor": TokenType.TENSOR,
        "block": TokenType.BLOCK,
        "scale": TokenType.SCALE,
        "zero": TokenType.ZERO,
        "sym": TokenType.SYM,
        "asym": TokenType.ASYM,
        "arm64": TokenType.ARM64,
        "x86_64": TokenType.X86_64,
        "generic": TokenType.GENERIC,
        "neon": TokenType.NEON,
        "avx2": TokenType.AVX2,
        "kda": TokenType.KDA,
        "mha": TokenType.MHA,
        "gqa": TokenType.GQA,
        "learned": TokenType.LEARNED,
        "fixed": TokenType.FIXED,
    }
    TYPES = {
        "mxfp4": TokenType.MXFP4,
        "int8": TokenType.INT8,
        "int4": TokenType.INT4,
        "bf16": TokenType.BF16,
        "fp16": TokenType.FP16,
        "fp32": TokenType.FP32,
    }
    SINGLE_CHAR = {
        "[": TokenType.LBRACKET,
        "]": TokenType.RBRACKET,
        "{": TokenType.LBRACE,
        "}": TokenType.RBRACE,
        "(": TokenType.LPAREN,
        ")": TokenType.RPAREN,
        ";": TokenType.SEMICOLON,
        ",": TokenType.COMMA,
        "=": TokenType.ASSIGN,
        "+": TokenType.PLUS,
        "-": TokenType.MINUS,
        "*": TokenType.STAR,
        "/": TokenType.SLASH,
        "@": TokenType.AT,
        ":": TokenType.COLON,
        "<": TokenType.LT,
        ">": TokenType.GT,
        "?": TokenType.QUESTION,
        "%": TokenType.PERCENT,
    }

    def __init__(self, source: str):
        self.source = source
        self.pos = 0
        self.line = 1
        self.col = 1

    def tokenize(self) -> list[Token]:
        tokens: list[Token] = []
        while self.pos < len(self.source):
            ch = self._peek()
            if ch in " \t\r":
                self._skip_whitespace()
            elif ch == "\n":
                tokens.append(Token(TokenType.NEWLINE, self._advance(), self.line - 1, 1))
            elif ch == "/" and self._peek(1) in {"/", "*"}:
                tokens.append(self._read_comment())
            elif ch.isalpha() or ch == "_":
                tokens.append(self._read_ident())
            elif ch.isdigit():
                tokens.append(self._read_number())
            elif ch == '"':
                tokens.append(self._read_string())
            elif ch in self.SINGLE_CHAR:
                line, col = self.line, self.col
                tokens.append(Token(self.SINGLE_CHAR[ch], self._advance(), line, col))
            else:
                line, col = self.line, self.col
                tokens.append(Token(TokenType.UNKNOWN, self._advance(), line, col))
        tokens.append(Token(TokenType.EOF, "", self.line, self.col))
        return tokens

    def _peek(self, offset: int = 0) -> str:
        idx = self.pos + offset
        if idx >= len(self.source):
            return ""
        return self.source[idx]

    def _advance(self) -> str:
        ch = self.source[self.pos]
        self.pos += 1
        if ch == "\n":
            self.line += 1
            self.col = 1
        else:
            self.col += 1
        return ch

    def _skip_whitespace(self):
        while self._peek() in " \t\r":
            self._advance()

    def _read_ident(self) -> Token:
        line, col = self.line, self.col
        value = ""
        while re.match(r"[A-Za-z0-9_]", self._peek() or "\0"):
            value += self._advance()
        if value in self.TYPES:
            return Token(self.TYPES[value], value, line, col)
        return Token(self.KEYWORDS.get(value.lower(), TokenType.IDENT), value, line, col)

    def _read_number(self) -> Token:
        line, col = self.line, self.col
        value = ""
        while self._peek().isdigit():
            value += self._advance()
        unit = ""
        while self._peek().isalpha():
            unit += self._advance()
        if unit:
            value += unit
            if re.fullmatch(r"\d+(B|KB|MB|GB)", value):
                return Token(TokenType.MEM_LITERAL, value, line, col)
            return Token(TokenType.UNKNOWN, value, line, col)
        return Token(TokenType.INT, value, line, col)

    def _read_string(self) -> Token:
        line, col = self.line, self.col
        value = self._advance()
        escaped = False
        while self.pos < len(self.source):
            ch = self._advance()
            value += ch
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                break
        return Token(TokenType.STRING, value, line, col)

    def _read_mem_literal(self) -> Token:
        return self._read_number()

    def _read_comment(self) -> Token:
        line, col = self.line, self.col
        value = self._advance() + self._advance()
        if value == "//":
            while self.pos < len(self.source) and self._peek() != "\n":
                value += self._advance()
        else:
            while self.pos < len(self.source):
                ch = self._advance()
                value += ch
                if ch == "*" and self._peek() == "/":
                    value += self._advance()
                    break
        return Token(TokenType.COMMENT, value, line, col)
