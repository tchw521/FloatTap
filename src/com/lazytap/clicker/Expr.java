package com.lazytap.clicker;

/**
 * 极简表达式求值器：够脚本用就行。
 *
 * 支持：数字、字符串、变量、+ - * / % 与括号、比较 == != > >= < <=、
 * 逻辑 && || !，以及 rand / abs / min / max / round / int / len 几个函数。
 * 整数结果不输出小数点，方便直接塞进「第几步」这类整数字段。
 *
 * 刻意不支持：赋值、逗号、三元、位运算——脚本里用不上，省下的都是体积。
 */
public final class Expr {

    public interface Scope {
        /** 取变量值；未定义返回 null */
        String get(String name);
    }

    private Expr() {
    }

    /** 求值，语法错或算不出来返回 null，由调用方兜底（保留原文最容易看出问题） */
    public static String eval(String src, Scope sc) {
        if (src == null) return null;
        String s = src.trim();
        if (s.isEmpty()) return null;
        try {
            P p = new P(s, sc);
            V v = p.or();
            p.ws();
            if (p.i < p.n) return null;      // 尾巴上还有东西 = 语法不认识
            return v == null ? null : v.text();
        } catch (Throwable t) {
            return null;
        }
    }

    // ---------- 值：一个数或一个字符串，二者必居其一 ----------
    static final class V {
        double n;
        String s;
        boolean str;

        static V num(double d) {
            V v = new V();
            v.n = d;
            return v;
        }

        static V of(String s) {
            V v = new V();
            v.s = s == null ? "" : s;
            v.str = true;
            return v;
        }

        double num() {
            if (!str) return n;
            try {
                return Double.parseDouble(s.trim());
            } catch (Exception e) {
                return 0;
            }
        }

        /** 能当数字用的字符串（如 "540"），比较和运算时按数字处理 */
        boolean numeric() {
            if (!str) return true;
            if (s.trim().isEmpty()) return false;
            try {
                Double.parseDouble(s.trim());
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        boolean truth() {
            return str ? !s.isEmpty() : n != 0;
        }

        String text() {
            if (str) return s;
            return fmt(n);
        }
    }

    /** 整数不带小数点，小数最多 6 位且去掉尾随 0 */
    static String fmt(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return "0";
        if (Math.abs(d - Math.rint(d)) < 1e-9) return String.valueOf((long) Math.rint(d));
        String s = String.format(java.util.Locale.US, "%.6f", d);
        while (s.endsWith("0")) s = s.substring(0, s.length() - 1);
        if (s.endsWith(".")) s = s.substring(0, s.length() - 1);
        return s;
    }

    // ---------- 递归下降 ----------
    private static final class P {
        final String src;
        final Scope sc;
        int i;
        final int n;

        P(String s, Scope sc) {
            this.src = s;
            this.sc = sc;
            this.n = s.length();
        }

        void ws() {
            while (i < n && src.charAt(i) <= ' ') i++;
        }

        boolean eat(String op) {
            ws();
            if (src.startsWith(op, i)) {
                i += op.length();
                return true;
            }
            return false;
        }

        char peek() {
            ws();
            return i < n ? src.charAt(i) : 0;
        }

        V or() {
            V a = and();
            while (eat("||")) {
                V b = and();
                a = V.num(a.truth() || b.truth() ? 1 : 0);
            }
            return a;
        }

        V and() {
            V a = cmp();
            while (eat("&&")) {
                V b = cmp();
                a = V.num(a.truth() && b.truth() ? 1 : 0);
            }
            return a;
        }

        /** 只做一层比较，不连锁（a<b<c 这种写法没意义，会在外层被判成语法错） */
        V cmp() {
            V a = add();
            ws();
            String op = null;
            if (src.startsWith(">=", i)) { op = ">="; i += 2; }
            else if (src.startsWith("<=", i)) { op = "<="; i += 2; }
            else if (src.startsWith("!=", i)) { op = "!="; i += 2; }
            else if (src.startsWith("==", i)) { op = "=="; i += 2; }
            else if (i < n && src.charAt(i) == '>') { op = ">"; i++; }
            else if (i < n && src.charAt(i) == '<') { op = "<"; i++; }
            if (op == null) return a;
            V b = add();
            boolean both = a.numeric() && b.numeric();
            boolean hit;
            if (op.equals("==")) hit = both ? a.num() == b.num() : a.text().equals(b.text());
            else if (op.equals("!=")) hit = !(both ? a.num() == b.num() : a.text().equals(b.text()));
            else {
                double x = a.num(), y = b.num();
                hit = op.equals(">") ? x > y : op.equals(">=") ? x >= y : op.equals("<") ? x < y : x <= y;
            }
            return V.num(hit ? 1 : 0);
        }

        V add() {
            V a = mul();
            for (; ; ) {
                ws();
                if (i >= n) return a;
                char c = src.charAt(i);
                if (c == '+') {
                    i++;
                    V b = mul();
                    if (a.str || b.str) a = V.of(a.text() + b.text());
                    else a = V.num(a.n + b.n);
                } else if (c == '-') {
                    i++;
                    V b = mul();
                    a = V.num(a.num() - b.num());
                } else return a;
            }
        }

        V mul() {
            V a = unary();
            for (; ; ) {
                ws();
                if (i >= n) return a;
                char c = src.charAt(i);
                if (c == '*') {
                    i++;
                    a = V.num(a.num() * unary().num());
                } else if (c == '/') {
                    i++;
                    double d = unary().num();
                    a = V.num(d == 0 ? 0 : a.num() / d);   // 除零给 0，脚本不该因为除零崩掉
                } else if (c == '%') {
                    i++;
                    double d = unary().num();
                    a = V.num(d == 0 ? 0 : a.num() % d);
                } else return a;
            }
        }

        V unary() {
            ws();
            if (i < n && src.charAt(i) == '-') {
                i++;
                return V.num(-unary().num());
            }
            if (i < n && src.charAt(i) == '+') {
                i++;
                return unary();
            }
            if (i < n && src.charAt(i) == '!') {
                i++;
                return V.num(unary().truth() ? 0 : 1);
            }
            return primary();
        }

        V primary() {
            ws();
            if (i >= n) throw new RuntimeException("空表达式");
            char c = src.charAt(i);
            if (c == '(') {
                i++;
                V v = or();
                ws();
                if (i >= n || src.charAt(i) != ')') throw new RuntimeException("括号没配对");
                i++;
                return v;
            }
            if (c == '"' || c == '\'') {
                StringBuilder sb = new StringBuilder();
                char q = c;
                i++;
                while (i < n && src.charAt(i) != q) {
                    if (src.charAt(i) == '\\' && i + 1 < n) i++;
                    sb.append(src.charAt(i++));
                }
                if (i >= n) throw new RuntimeException("引号没配对");
                i++;
                return V.of(sb.toString());
            }
            if (c >= '0' && c <= '9') return V.num(number());
            if (c == '.' ) return V.num(number());
            // 标识符：可能是函数调用或变量
            int st = i;
            while (i < n && isId(src.charAt(i))) i++;
            String name = src.substring(st, i);
            if (name.isEmpty()) throw new RuntimeException("认不出 " + c);
            ws();
            if (i < n && src.charAt(i) == '(') {
                i++;
                return call(name, args());
            }
            String v = sc == null ? null : sc.get(name);
            if (v == null) return V.num(0);      // 未定义变量当 0，脚本容错
            // 变量值看着像数字就按数字算，否则 n+1 会拼成 "31" 而不是 4
            if (looksNum(v)) return V.num(Double.parseDouble(v.trim()));
            return V.of(v);
        }

        double number() {
            int st = i;
            while (i < n && ((src.charAt(i) >= '0' && src.charAt(i) <= '9') || src.charAt(i) == '.')) i++;
            if (i < n && (src.charAt(i) == 'e' || src.charAt(i) == 'E')) {
                i++;
                if (i < n && (src.charAt(i) == '+' || src.charAt(i) == '-')) i++;
                while (i < n && src.charAt(i) >= '0' && src.charAt(i) <= '9') i++;
            }
            try {
                return Double.parseDouble(src.substring(st, i));
            } catch (Exception e) {
                throw new RuntimeException("数字写错了");
            }
        }

        /** 解析函数调用的参数表，最多 4 个，返回长度正好是参数个数 */
        V[] args() {
            V[] out = new V[4];
            int k = 0;
            ws();
            if (i < n && src.charAt(i) == ')') {
                i++;
                return new V[0];
            }
            while (k < 4) {
                out[k++] = or();
                ws();
                if (i < n && src.charAt(i) == ',') {
                    i++;
                    continue;
                }
                if (i < n && src.charAt(i) == ')') {
                    i++;
                    break;
                }
                throw new RuntimeException("参数表写错了");
            }
            V[] r = new V[k];
            System.arraycopy(out, 0, r, 0, k);
            return r;
        }

        V call(String name, V[] a) {
            switch (name) {
                case "rand":
                    // rand() → 0..99；rand(10) → 0..9；rand(1,10) → 1..10（含两端）
                    if (a.length >= 2 && a[1].num() > a[0].num()) {
                        double lo = a[0].num(), hi = a[1].num();
                        return V.num((long) (lo + Math.random() * (hi - lo + 1)));
                    }
                    double top = a.length >= 1 && a[0].num() != 0 ? a[0].num() : 100;
                    return V.num((long) (Math.random() * top));
                case "abs":
                    return V.num(Math.abs(a[0].num()));
                case "min":
                    return V.num(Math.min(a[0].num(), a[1].num()));
                case "max":
                    return V.num(Math.max(a[0].num(), a[1].num()));
                case "round":
                    return V.num(Math.round(a[0].num()));
                case "int":
                    return V.num((long) a[0].num());
                case "len":
                    return V.num(a.length > 0 ? a[0].text().length() : 0);
                default:
                    throw new RuntimeException("没有这个函数 " + name);
            }
        }

        static boolean looksNum(String s) {
            if (s == null) return false;
            String t = s.trim();
            if (t.isEmpty()) return false;
            try {
                Double.parseDouble(t);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        static boolean isId(char c) {
            return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '_' || c == '.' || c == '：' || c > 127;   // 允许中文变量名
        }
    }
}
