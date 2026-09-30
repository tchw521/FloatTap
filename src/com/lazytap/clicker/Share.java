package com.lazytap.clicker;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.DataFormatException;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/**
 * 脚本分享码（v1.8.0）：把脚本压成一段能复制、能粘贴、能发微信的短文本。
 *
 * 格式：  LT1.<base64url(deflate(json))>
 *
 * 两个刻意的选择：
 *  - 用 Deflater 而不是自己写压缩：java.util.zip 在 Android 和 JDK 里都有，零依赖，
 *    JSON 又恰好是压缩率很高的输入，实测能压到原文的 1/4 左右
 *  - Base64 自己实现而不用 android.util.Base64：这样这个类没有任何 Android 依赖，
 *    可以直接在 JDK 下跑单测，不用为了测试去造 stub
 *
 * 内容是 {"v":1,"d":...}，d 可以是单个脚本对象，也可以是脚本数组（全部导出）。
 */
public final class Share {

    public static final String PREFIX = "LT1.";

    private Share() {
    }

    /** 把一个脚本编码成分享码 */
    public static String one(JSONObject script) {
        JSONObject o = new JSONObject();
        try {
            o.put("v", 1);
            o.put("t", "one");
            o.put("d", pack(script));
        } catch (Exception e) {
            return "";
        }
        return enc(o.toString());
    }

    /** 把一批脚本（导出全部）编码成分享码 */
    public static String all(JSONArray scripts) {
        JSONObject o = new JSONObject();
        JSONArray pack = new JSONArray();
        for (int i = 0; i < scripts.length(); i++) pack.put(pack(scripts.optJSONObject(i)));
        try {
            o.put("v", 1);
            o.put("t", "all");
            o.put("d", pack);
        } catch (Exception e) {
            return "";
        }
        return enc(o.toString());
    }

    // ---------------- 脚本 ⇄ 紧凑数组 ----------------
    // 分享码里用数组而不是对象：省掉全部键名，实测能让码短一半。
    // 顺序是固定的，加字段只能往末尾加，并且要同步改 unpack。

    private static JSONArray pack(JSONObject s) {
        JSONArray a = new JSONArray();
        if (s == null) return a;
        a.put(s.optString("name", ""));
        a.put(s.optString("desc", ""));
        a.put(s.optString("icon", "📜"));
        a.put(s.optInt("tone", 1));
        a.put(s.optString("kind", ""));
        a.put(s.optString("code", ""));
        a.put(s.optBoolean("loop", false) ? 1 : 0);
        a.put(s.optInt("loopCount", 1));
        a.put(s.optInt("startDelay", 0));
        a.put(s.optBoolean("jitter", false) ? 1 : 0);
        a.put(s.optBoolean("stopOnFail", false) ? 1 : 0);
        a.put(s.optJSONArray("actions") != null ? s.optJSONArray("actions") : new JSONArray());
        a.put(s.optJSONArray("vars") != null ? s.optJSONArray("vars") : new JSONArray());
        return a;
    }

    private static JSONObject unpack(JSONArray a) {
        JSONObject s = new JSONObject();
        try {
            s.put("id", "s" + System.currentTimeMillis() + (Math.random() * 1e6 < 1 ? 0 : (int) (Math.random() * 100000)));
            s.put("name", a.optString(0, "导入的脚本"));
            s.put("desc", a.optString(1, ""));
            s.put("icon", a.optString(2, "📜"));
            s.put("tone", a.optInt(3, 1));
            s.put("kind", a.optString(4, ""));
            s.put("code", a.optString(5, ""));
            s.put("loop", a.optInt(6, 0) == 1);
            s.put("loopCount", Math.max(1, a.optInt(7, 1)));
            s.put("startDelay", Math.max(0, a.optInt(8, 0)));
            s.put("jitter", a.optInt(9, 0) == 1);
            s.put("stopOnFail", a.optInt(10, 0) == 1);
            JSONArray acts = a.optJSONArray(11);
            s.put("actions", acts != null ? acts : new JSONArray());
            JSONArray vs = a.optJSONArray(12);
            s.put("vars", vs != null ? vs : new JSONArray());
        } catch (Exception ignored) {
        }
        return s;
    }

    /**
     * 解码一段分享码。
     * 返回 JSON：{"kind":"one","script":{...}} 或 {"kind":"all","scripts":[...]}；
     * 出错时返回 {"err":"人话"}，不抛异常——调用方是 UI，宁可给一句话也不要崩。
     */
    public static JSONObject decode(String code) {
        JSONObject bad = new JSONObject();
        if (code == null) return err(bad, "分享码是空的");
        String s = code.trim().replaceAll("\\s+", "");   // 微信复制过来常带换行和空格
        if (s.isEmpty()) return err(bad, "分享码是空的");
        if (!s.startsWith(PREFIX)) {
            return err(bad, "这不像懒人点击器的分享码（应该以 " + PREFIX + " 开头）");
        }
        s = s.substring(PREFIX.length());
        String json;
        try {
            json = dec(s);
        } catch (Exception e) {
            return err(bad, "分享码读不出来，可能复制的时候缺了一截");
        }
        if (json == null || json.isEmpty()) return err(bad, "分享码读不出来，可能复制的时候缺了一截");
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (Exception e) {
            return err(bad, "分享码里的内容不是合法 JSON");
        }
        int v = o.optInt("v", 0);
        if (v != 1) return err(bad, "这个分享码的版本是 " + v + "，我这版还不认识");
        String t = o.optString("t", "one");
        Object d = o.opt("d");
        JSONObject out = new JSONObject();
        try {
            if ("all".equals(t)) {
                if (!(d instanceof JSONArray)) return err(bad, "分享码里没有脚本");
                JSONArray src = (JSONArray) d;
                JSONArray list = new JSONArray();
                for (int i = 0; i < src.length(); i++) list.put(unpack(src.optJSONArray(i)));
                out.put("kind", "all");
                out.put("scripts", list);
            } else {
                if (!(d instanceof JSONArray)) return err(bad, "分享码里没有脚本");
                out.put("kind", "one");
                out.put("script", unpack((JSONArray) d));
            }
        } catch (Exception e) {
            return err(bad, "分享码解析失败");
        }
        return out;
    }

    // ---------------- 压缩 / 解压 ----------------

    private static String enc(String json) {
        byte[] raw = json.getBytes(StandardCharsets.UTF_8);
        byte[] z = deflate(raw);
        // 压不动就别压：几十字节的小脚本压完反而更长，base64 那 33% 膨胀吃掉了收益
        boolean zipped = z != null && z.length < raw.length;
        return PREFIX + (zipped ? "Z" : "R") + b64(zipped ? z : raw);
    }

    private static byte[] deflate(byte[] raw) {
        Deflater d = new Deflater(Deflater.BEST_COMPRESSION, true);   // nowrap：省掉 zlib 头尾
        d.setInput(raw);
        d.finish();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        try {
            while (!d.finished()) {
                int n = d.deflate(buf);
                bo.write(buf, 0, n);
            }
        } catch (Throwable t) {
            return null;
        } finally {
            d.end();
        }
        return bo.toByteArray();
    }

    private static String dec(String body) throws IOException, DataFormatException {
        if (body == null || body.length() < 2) throw new IOException("分享码太短");
        char flag = body.charAt(0);
        String payload = body.substring(1);
        if (flag == 'R') return new String(unb64(payload), StandardCharsets.UTF_8);
        if (flag != 'Z') throw new IOException("分享码格式不认识");
        return inflate(payload);
    }

    private static String inflate(String payload) throws IOException, DataFormatException {
        byte[] z = unb64(payload);
        Inflater in = new Inflater(true);
        in.setInput(z);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        try {
            while (!in.finished()) {
                int n = in.inflate(buf);
                if (n == 0) {
                    if (in.needsInput() || in.needsDictionary()) break;   // 数据不完整
                    else break;
                }
                bo.write(buf, 0, n);
            }
        } finally {
            in.end();
        }
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }

    // ---------------- Base64URL（自己实现，为的是能在 JDK 下直接测） ----------------

    private static final char[] T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();
    private static final int[] R = new int[256];

    static {
        for (int i = 0; i < R.length; i++) R[i] = -1;
        for (int i = 0; i < T.length; i++) R[T[i]] = i;
        R['+'] = R['-'];            // 有人把 URL 安全字符换回标准字符，宽容一点
        R['/'] = R['_'];
    }

    private static String b64(byte[] b) {
        StringBuilder sb = new StringBuilder((b.length + 2) / 3 * 4);
        for (int i = 0; i < b.length; i += 3) {
            int left = b.length - i;
            int v = (b[i] & 0xff) << 16;
            if (left > 1) v |= (b[i + 1] & 0xff) << 8;
            if (left > 2) v |= (b[i + 2] & 0xff);
            sb.append(T[(v >>> 18) & 63]);
            sb.append(T[(v >>> 12) & 63]);
            sb.append(left > 1 ? T[(v >>> 6) & 63] : '=');
            sb.append(left > 2 ? T[v & 63] : '=');
        }
        return sb.toString();
    }

    private static byte[] unb64(String s) throws IOException {
        // 去掉填充，按 URL 安全字符集解析
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '=' || c == '\n' || c == '\r' || c == ' ') continue;
            int v = c < 256 ? R[c] : -1;
            if (v < 0) throw new IOException("bad base64 char: " + c);
            sb.append(T[v]);
        }
        int len = sb.length();
        if (len % 4 == 1) throw new IOException("bad base64 length");
        int out = len / 4 * 3;
        if (len % 4 == 2) out += 1;
        else if (len % 4 == 3) out += 2;
        byte[] b = new byte[out];
        int p = 0;
        int acc = 0, bits = 0;
        for (int i = 0; i < len; i++) {
            acc = (acc << 6) | R[sb.charAt(i)];
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                b[p++] = (byte) ((acc >>> bits) & 0xff);
            }
        }
        return b;
    }

    private static JSONObject err(JSONObject o, String m) {
        try {
            o.put("err", m);
        } catch (Exception ignored) {
        }
        return o;
    }
}
