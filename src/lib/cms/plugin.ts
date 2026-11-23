/**
 * Plugin de WordPress de FSV Search, generado por proyecto con su dirección de la API y su secreto.
 *
 * - Reescribe el HTML final de cada página pública (buffer de salida) con las correcciones aprobadas: title,
 *   meta description, canonical, Open Graph, hreflang, JSON-LD, alt de imágenes y links rotos. Funciona igual con
 *   Yoast, Rank Math, All in One SEO o sin plugin SEO, porque cambia lo que el servidor entrega.
 * - Hace las redirecciones 301 aprobadas antes de que WordPress responda 404.
 * - Recibe artículos como borrador (con título y descripción SEO para Yoast o Rank Math).
 * Las correcciones se guardan 5 minutos en caché por página; si la API no responde, la página sale como siempre.
 */
export const PLUGIN_VERSION = "1.0.0";

const php = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function wordpressPlugin(o: { api: string; secret: string; app: string }): string {
  return `<?php
/**
 * Plugin Name: FSV Search
 * Plugin URI: ${o.app}
 * Description: Aplica en el servidor las correcciones SEO aprobadas en FSV Search (título, descripción, canonical, Open Graph, datos estructurados, textos de imagen, links rotos y redirecciones 301) y recibe artículos como borrador.
 * Version: ${PLUGIN_VERSION}
 * Requires at least: 5.6
 * Requires PHP: 7.2
 * Author: FSV Search
 * License: GPLv2 or later
 */
if (!defined('ABSPATH')) exit;

define('FSV_SEARCH_VERSION', '${PLUGIN_VERSION}');
define('FSV_SEARCH_API', ${php(o.api)});
define('FSV_SEARCH_SECRET', ${php(o.secret)});

/** Misma clave de página que usa FSV Search: ruta sin barra final y parámetros ordenados sin los de seguimiento. */
function fsv_search_key($uri) {
  $parts = explode('?', $uri, 2);
  $path = rawurldecode($parts[0]);
  $path = rtrim($path, '/');
  if ($path === '') $path = '/';
  $out = array();
  if (isset($parts[1]) && $parts[1] !== '') {
    foreach (explode('&', $parts[1]) as $kv) {
      if ($kv === '' || preg_match('/^(utm_[^=]*|gclid|gclsrc|dclid|fbclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl)(=|$)/i', $kv)) continue;
      $out[] = $kv;
    }
    sort($out, SORT_STRING);
  }
  return $out ? $path . '?' . implode('&', $out) : $path;
}

/** URL comparable: misma web (con o sin www, http o https) → ruta; otro dominio → URL completa sin fragmento. */
function fsv_search_norm($url) {
  $url = html_entity_decode(trim($url), ENT_QUOTES);
  $home = wp_parse_url(home_url('/'));
  $host = isset($home['host']) ? preg_replace('/^www\\./i', '', strtolower($home['host'])) : '';
  if (strpos($url, '//') === 0) $url = 'https:' . $url;
  $p = wp_parse_url($url);
  if (!$p) return $url;
  $h = isset($p['host']) ? preg_replace('/^www\\./i', '', strtolower($p['host'])) : $host;
  $path = isset($p['path']) ? $p['path'] : '/';
  if (!isset($p['host']) && strpos($path, '/') !== 0) return $url;
  $q = isset($p['query']) ? '?' . $p['query'] : '';
  if ($h === $host) {
    $r = rtrim($path, '/') . $q;
    return $r === '' ? '/' : $r;
  }
  return preg_replace('/#.*$/', '', rtrim($url, '/'));
}

function fsv_search_data() {
  static $data = null;
  if ($data !== null) return $data;
  $key = fsv_search_key(isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '/');
  $t = 'fsv_s_' . md5($key);
  $cached = get_transient($t);
  if ($cached === false) {
    $r = wp_remote_get(FSV_SEARCH_API . '/page.json?u=' . rawurlencode($key), array('timeout' => 3, 'headers' => array('X-FSV-Plugin' => FSV_SEARCH_VERSION)));
    $cached = array();
    if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) === 200) {
      $j = json_decode(wp_remote_retrieve_body($r), true);
      if (is_array($j)) $cached = $j;
    }
    // si la API no respondió, se reintenta en un minuto; si respondió, cinco
    set_transient($t, $cached, $cached ? 300 : 60);
  }
  return $data = $cached;
}

function fsv_search_public_request() {
  if (is_admin() || wp_doing_ajax() || wp_doing_cron() || is_feed() || is_robots() || is_trackback()) return false;
  if (defined('REST_REQUEST') && REST_REQUEST) return false;
  if (isset($_SERVER['REQUEST_METHOD']) && !in_array($_SERVER['REQUEST_METHOD'], array('GET', 'HEAD'), true)) return false;
  if (function_exists('is_customize_preview') && is_customize_preview()) return false;
  return true;
}

add_action('template_redirect', function () {
  if (!fsv_search_public_request()) return;
  $d = fsv_search_data();
  if (!empty($d['redirect']) && is_string($d['redirect'])) {
    wp_redirect($d['redirect'], 301, 'FSV Search');
    exit;
  }
  if (!empty($d['ops'])) ob_start('fsv_search_rewrite');
}, 0);

/** Reemplaza la primera etiqueta que calza o la agrega al <head>. */
function fsv_search_set(&$html, &$head, $pattern, $tag) {
  if (preg_match($pattern, $html)) {
    $html = preg_replace_callback($pattern, function () use ($tag) { return $tag; }, $html, 1);
  } else {
    $head .= $tag . "\\n";
  }
}

function fsv_search_rewrite($html) {
  if (stripos($html, '</head>') === false) return $html;
  foreach (headers_list() as $h) {
    if (stripos($h, 'content-type:') === 0 && stripos($h, 'text/html') === false) return $html;
  }
  $d = fsv_search_data();
  $ops = isset($d['ops']) && is_array($d['ops']) ? $d['ops'] : array();
  $head = '';
  $alts = array();
  $links = array();
  foreach ($ops as $op) {
    if (!is_array($op) || count($op) < 3) continue;
    list($k, $t, $v) = $op;
    $v = (string) $v;
    $t = (string) $t;
    switch ($k) {
      case 'title':
        fsv_search_set($html, $head, '/<title\\b[^>]*>.*?<\\/title>/is', '<title>' . esc_html($v) . '</title>');
        break;
      case 'meta':
        fsv_search_set($html, $head, '/<meta\\b[^>]*\\bname=["\\']description["\\'][^>]*>/i', '<meta name="description" content="' . esc_attr($v) . '" />');
        break;
      case 'canonical':
        fsv_search_set($html, $head, '/<link\\b[^>]*\\brel=["\\']canonical["\\'][^>]*>/i', '<link rel="canonical" href="' . esc_url($v) . '" />');
        break;
      case 'og':
        $attr = strpos($t, 'twitter:') === 0 ? 'name' : 'property';
        fsv_search_set($html, $head, '/<meta\\b[^>]*\\b(?:property|name)=["\\']' . preg_quote($t, '/') . '["\\'][^>]*>/i', '<meta ' . $attr . '="' . esc_attr($t) . '" content="' . esc_attr($v) . '" />');
        break;
      case 'hreflang':
        fsv_search_set($html, $head, '/<link\\b[^>]*\\bhreflang=["\\']' . preg_quote($t, '/') . '["\\'][^>]*>/i', '<link rel="alternate" hreflang="' . esc_attr($t) . '" href="' . esc_url($v) . '" />');
        break;
      case 'jsonld':
        $json = json_decode($v);
        if ($json !== null) $head .= '<script type="application/ld+json" data-fsv-search>' . wp_json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . "</script>\\n";
        break;
      case 'alt':
        $alts[fsv_search_norm($t)] = $v;
        break;
      case 'link':
        $links[rtrim(fsv_search_norm($t), '/')] = $v;
        break;
    }
  }
  if ($alts) {
    $html = preg_replace_callback('/<img\\b[^>]*>/i', function ($m) use ($alts) {
      $tag = $m[0];
      if (preg_match('/\\balt=(["\\'])\\s*[^"\\'\\s][^"\\']*\\1/i', $tag)) return $tag;
      if (!preg_match('/\\b(?:data-src|src)=(["\\'])([^"\\']+)\\1/i', $tag, $s)) return $tag;
      $key = fsv_search_norm($s[2]);
      if (!isset($alts[$key])) return $tag;
      $tag = preg_replace('/\\salt=(["\\'])\\s*\\1/i', '', $tag);
      return preg_replace('/^<img\\b/i', '<img alt="' . esc_attr($alts[$key]) . '"', $tag, 1);
    }, $html);
  }
  if ($links) {
    $html = preg_replace_callback('/(<a\\b[^>]*\\bhref=)(["\\'])([^"\\']*)\\2/i', function ($m) use ($links) {
      $key = rtrim(fsv_search_norm($m[3]), '/');
      return isset($links[$key]) ? $m[1] . $m[2] . esc_url($links[$key]) . $m[2] : $m[0];
    }, $html);
  }
  if ($head !== '') {
    $pos = stripos($html, '</head>');
    $html = substr($html, 0, $pos) . "<!-- FSV Search -->\\n" . $head . substr($html, $pos);
  }
  return $html;
}

// ── API para FSV Search (peticiones firmadas) ──────────────────────────────────

function fsv_search_signed(WP_REST_Request $req) {
  $time = (int) $req->get_header('x_fsv_time');
  $sig = (string) $req->get_header('x_fsv_signature');
  if (!$time || abs(time() - $time) > 300) return new WP_Error('fsv_bad_signature', 'Firma vencida', array('status' => 401));
  $expected = hash_hmac('sha256', $time . "\\n" . $req->get_method() . "\\n" . $req->get_route() . "\\n" . $req->get_body(), FSV_SEARCH_SECRET);
  if (!hash_equals($expected, $sig)) return new WP_Error('fsv_bad_signature', 'Firma inválida', array('status' => 401));
  return true;
}

function fsv_search_seo_plugin() {
  if (defined('WPSEO_VERSION')) return 'Yoast SEO';
  if (defined('RANK_MATH_VERSION')) return 'Rank Math';
  if (defined('AIOSEO_VERSION')) return 'All in One SEO';
  if (defined('SEOPRESS_VERSION')) return 'SEOPress';
  return null;
}

add_action('rest_api_init', function () {
  register_rest_route('fsv-search/v1', '/status', array(
    'methods' => 'GET',
    'permission_callback' => 'fsv_search_signed',
    'callback' => function () {
      return array('plugin' => FSV_SEARCH_VERSION, 'wordpress' => get_bloginfo('version'), 'name' => get_bloginfo('name'), 'url' => home_url('/'), 'seo' => fsv_search_seo_plugin());
    },
  ));
  register_rest_route('fsv-search/v1', '/flush', array(
    'methods' => 'POST',
    'permission_callback' => 'fsv_search_signed',
    'callback' => function () {
      global $wpdb;
      $n = $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\\\_transient\\\\_fsv\\\\_s\\\\_%' OR option_name LIKE '\\\\_transient\\\\_timeout\\\\_fsv\\\\_s\\\\_%'");
      if (function_exists('wp_cache_flush_group')) wp_cache_flush_group('transient');
      return array('ok' => true, 'cleared' => (int) $n);
    },
  ));
  register_rest_route('fsv-search/v1', '/draft', array(
    'methods' => 'POST',
    'permission_callback' => 'fsv_search_signed',
    'callback' => function (WP_REST_Request $req) {
      $b = json_decode($req->get_body(), true);
      if (!is_array($b) || empty($b['title']) || empty($b['content'])) return new WP_Error('fsv_bad_request', 'Faltan título o contenido', array('status' => 400));
      $data = array(
        'post_type' => 'post',
        'post_status' => 'draft',
        'post_title' => sanitize_text_field($b['title']),
        'post_content' => wp_kses_post($b['content']),
        'post_excerpt' => isset($b['excerpt']) ? sanitize_textarea_field($b['excerpt']) : '',
        'post_name' => isset($b['slug']) ? sanitize_title($b['slug']) : '',
      );
      $id = isset($b['id']) ? (int) $b['id'] : 0;
      if ($id && get_post_status($id) === 'draft') {
        $data['ID'] = $id;
        $id = wp_update_post($data, true);
      } else {
        $id = wp_insert_post($data, true);
      }
      if (is_wp_error($id)) return $id;
      if (!empty($b['meta_title'])) {
        update_post_meta($id, '_yoast_wpseo_title', sanitize_text_field($b['meta_title']));
        update_post_meta($id, 'rank_math_title', sanitize_text_field($b['meta_title']));
      }
      if (!empty($b['meta_description'])) {
        update_post_meta($id, '_yoast_wpseo_metadesc', sanitize_textarea_field($b['meta_description']));
        update_post_meta($id, 'rank_math_description', sanitize_textarea_field($b['meta_description']));
      }
      return array('id' => $id, 'edit' => admin_url('post.php?post=' . $id . '&action=edit'), 'preview' => get_preview_post_link($id));
    },
  ));
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
  $links[] = '<a href="' . esc_url(${php(o.app)}) . '" target="_blank" rel="noopener">FSV Search</a>';
  return $links;
});
`;
}
