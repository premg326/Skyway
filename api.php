<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function reply(int $status, array $body): never { http_response_code($status); echo json_encode($body, JSON_UNESCAPED_SLASHES); exit; }
function body(): array { $data=json_decode(file_get_contents('php://input'),true); if(!is_array($data)) reply(400,['error'=>'Invalid JSON body']); return $data; }
function db(): PDO {
  static $pdo=null; if($pdo instanceof PDO) return $pdo;
  $host=getenv('DB_HOST') ?: '127.0.0.1'; $name=getenv('DB_NAME') ?: 'skyway'; $user=getenv('DB_USER') ?: 'root'; $pass=getenv('DB_PASS') ?: '';
  try { $pdo=new PDO("mysql:host=$host;dbname=$name;charset=utf8mb4",$user,$pass,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]); }
  catch(Throwable $e){ reply(503,['error'=>'Database is unavailable. Configure DB_HOST, DB_NAME, DB_USER and DB_PASS.']); }
  return $pdo;
}
$action=$_GET['action'] ?? '';
if($action==='search' && $_SERVER['REQUEST_METHOD']==='POST') {
  $d=body(); foreach(['origin','destination','depart_date'] as $k) if(empty($d[$k])) reply(422,['error'=>"Missing $k"]);
  $sql='SELECT id,airline,flight_number,origin,destination,departure_time,arrival_time,duration,stops,price,currency FROM flights WHERE active=1 AND (origin=:origin OR origin_code=:origin_code) AND (destination=:destination OR destination_code=:destination_code) AND DATE(departure_time)=:depart_date ORDER BY price ASC LIMIT 20';
  $stmt=db()->prepare($sql); $stmt->execute(['origin'=>$d['origin'],'origin_code'=>airport_code($d['origin']),'destination'=>$d['destination'],'destination_code'=>airport_code($d['destination']),'depart_date'=>$d['depart_date']]);
  reply(200,['flights'=>$stmt->fetchAll()]);
}
if($action==='book' && $_SERVER['REQUEST_METHOD']==='POST') {
  $d=body(); $t=$d['traveler']??[]; $f=$d['flight']??[];
  foreach(['first_name','last_name','email','phone'] as $k) if(empty($t[$k])) reply(422,['error'=>"Missing traveler $k"]);
  if(!filter_var($t['email'],FILTER_VALIDATE_EMAIL)) reply(422,['error'=>'Invalid email address']);
  $flightId=filter_var($f['id']??null,FILTER_VALIDATE_INT); if(!$flightId) reply(422,['error'=>'Select a valid flight']);
  $passengers=filter_var($d['passengers']??1,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>9]]); if(!$passengers) reply(422,['error'=>'Passenger count must be between 1 and 9']);
  $tripType=$d['trip_type']??'roundtrip'; if(!in_array($tripType,['oneway','roundtrip'],true)) reply(422,['error'=>'Choose one way or round trip']);
  $departDate=$d['depart_date']??''; $parsedDate=DateTime::createFromFormat('!Y-m-d',$departDate); if(!$parsedDate || $parsedDate->format('Y-m-d')!==$departDate) reply(422,['error'=>'Invalid departure date']);
  $returnDate=($d['return_date']??'') ?: null; if($tripType==='roundtrip' && (!$returnDate || $returnDate<$departDate)) reply(422,['error'=>'Enter a valid return date']); if($tripType==='oneway') $returnDate=null;
  $flightStmt=db()->prepare('SELECT price,currency FROM flights WHERE id=:id AND active=1 AND DATE(departure_time)=:depart_date'); $flightStmt->execute(['id'=>$flightId,'depart_date'=>$departDate]); $flight=$flightStmt->fetch(); if(!$flight) reply(422,['error'=>'This flight is no longer available. Search again.']);
  $total=(float)$flight['price']*$passengers*($tripType==='roundtrip'?1.82:1);
  $reference='SKY-'.strtoupper(bin2hex(random_bytes(3)));
  $pdo=db(); $pdo->beginTransaction();
  try { $s=$pdo->prepare('INSERT INTO bookings (reference,flight_id,first_name,last_name,email,phone,passengers,trip_type,depart_date,return_date,cabin,total_price,status) VALUES (:reference,:flight_id,:first_name,:last_name,:email,:phone,:passengers,:trip_type,:depart_date,:return_date,:cabin,:total_price,\'pending\')');
    $s->execute(['reference'=>$reference,'flight_id'=>$flightId,'first_name'=>$t['first_name'],'last_name'=>$t['last_name'],'email'=>$t['email'],'phone'=>$t['phone'],'passengers'=>$passengers,'trip_type'=>$tripType,'depart_date'=>$departDate,'return_date'=>$returnDate,'cabin'=>$d['cabin']??'Economy','total_price'=>$total]); $pdo->commit(); reply(201,['reference'=>$reference,'status'=>'pending','total'=>$total,'currency'=>$flight['currency']]);
  } catch(Throwable $e){$pdo->rollBack();reply(500,['error'=>'Could not save booking']);}
}
reply(404,['error'=>'Unknown endpoint']);
function airport_code(string $s): string { if(preg_match('/\(([A-Z]{3})\)/',$s,$m)) return $m[1]; return strtoupper(substr(trim($s),0,3)); }
