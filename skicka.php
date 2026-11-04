<?php
/* Returvallen – tar emot formulären och skickar dem som e-post till Robert.
   Körs på webbhotellet (one.com stöder PHP och mail()). Inga tredjepartstjänster.
   Fungerar både med JavaScript (svarar JSON) och utan (skickar vidare till /tack/). */

declare(strict_types=1);

const MOTTAGARE = 'robert@returvallen.se';
const AVSANDARE = 'webbplats@returvallen.se';   // ska vara en adress på returvallen.se
const MAX_PER_TIMME = 8;                          // per IP-adress, mot spam

$falt = [
    'formular' => 'Formulär', 'namn' => 'Namn', 'foretag' => 'Företag', 'telefon' => 'Telefon',
    'epost' => 'E-post', 'arende' => 'Ärende', 'material' => 'Material', 'mangd' => 'Mängd',
    'ort' => 'Var finns materialet', 'avfallstyp' => 'Vad ska i kärlet', 'period' => 'Hur länge',
    'adress' => 'Adress för utsättning', 'meddelande' => 'Meddelande', 'sida' => 'Skickat från sidan',
];

function svara(bool $ok, string $text, int $kod = 200): void {
    $vill_json = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');
    if ($vill_json) {
        http_response_code($kod);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'meddelande' => $text], JSON_UNESCAPED_UNICODE);
    } elseif ($ok) {
        header('Location: /tack/', true, 303);
    } else {
        http_response_code($kod);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><meta charset="utf-8"><title>Något saknas</title>'
           . '<p>' . htmlspecialchars($text) . '</p><p><a href="javascript:history.back()">Tillbaka</a> · Ring 011-10 20 80</p>';
    }
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    svara(false, 'Formuläret skickas med POST.', 405);
}

// Robotfälla: fältet är dolt för människor.
if (!empty($_POST['foretagsnamn_hp'])) {
    svara(true, 'Tack!');
}

// Enkel begränsning per IP-adress.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'okand';
$logg = sys_get_temp_dir() . '/rv_form_' . hash('sha256', $ip);
$tider = array_filter(
    is_file($logg) ? array_map('intval', file($logg, FILE_IGNORE_NEW_LINES)) : [],
    fn($t) => $t > time() - 3600
);
if (count($tider) >= MAX_PER_TIMME) {
    svara(false, 'Du har skickat många förfrågningar på kort tid. Ring 011-10 20 80 så hjälper vi dig direkt.', 429);
}

$data = [];
foreach ($falt as $nyckel => $_) {
    $v = trim((string)($_POST[$nyckel] ?? ''));
    $v = str_replace(["\r", "\0"], '', $v);
    if ($nyckel !== 'meddelande') { $v = str_replace("\n", ' ', $v); }
    $data[$nyckel] = mb_substr($v, 0, $nyckel === 'meddelande' ? 4000 : 200);
}

$fel = [];
if ($data['namn'] === '') { $fel[] = 'namn'; }
if (strlen(preg_replace('/\D/', '', $data['telefon'])) < 7) { $fel[] = 'telefon'; }
if ($data['epost'] !== '' && !filter_var($data['epost'], FILTER_VALIDATE_EMAIL)) { $fel[] = 'e-post'; }
if ($data['formular'] === 'containerforfragan' && $data['adress'] === '') { $fel[] = 'adress'; }
if (($_POST['samtycke'] ?? '') !== 'ja') { $fel[] = 'samtycke'; }
if ($fel) {
    svara(false, 'Något saknas eller stämmer inte: ' . implode(', ', $fel) . '.', 422);
}

$rubrik = [
    'prisforfragan' => 'Prisförfrågan', 'containerforfragan' => 'Containerförfrågan',
    'kupong' => 'Förfrågan från startsidan', 'kontaktformular' => 'Förfrågan',
][$data['formular']] ?? 'Förfrågan';

$rader = [];
foreach ($falt as $nyckel => $etikett) {
    if ($data[$nyckel] !== '' && $nyckel !== 'formular') {
        $rader[] = $nyckel === 'meddelande' ? "\n$etikett:\n" . $data[$nyckel] : "$etikett: " . $data[$nyckel];
    }
}
$text = $rubrik . " via returvallen.se\n\n" . implode("\n", $rader) . "\n\nSkickat " . date('Y-m-d H:i') . "\n";

$amne = '=?UTF-8?B?' . base64_encode($rubrik . ' – ' . $data['namn']) . '?=';
$huvud = [
    'From: Returvallen webbplats <' . AVSANDARE . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
];
if ($data['epost'] !== '') {
    $huvud[] = 'Reply-To: ' . $data['epost'];
}

if (getenv('RV_MAIL_TEST')) {
    // Testläge: skriv till fil i stället för att skicka.
    file_put_contents(getenv('RV_MAIL_TEST'), "To: " . MOTTAGARE . "\n" . implode("\n", $huvud) . "\nSubject: $amne\n\n$text\n----\n", FILE_APPEND);
    $skickat = true;
} else {
    $skickat = mail(MOTTAGARE, $amne, $text, implode("\r\n", $huvud), '-f' . AVSANDARE);
}

if (!$skickat) {
    svara(false, 'Det gick inte att skicka just nu. Ring 011-10 20 80 så hjälper vi dig direkt.', 500);
}

$tider[] = time();
@file_put_contents($logg, implode("\n", $tider));
svara(true, 'Tack! Din förfrågan är skickad. Vi hör av oss under kontorstid.');
