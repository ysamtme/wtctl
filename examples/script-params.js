// wtctl exec --input-file examples/script-params.js --params '{\"name\":\"Иван\",\"limit\":5}'
// Параметры приходят готовым объектом PARAMS: в текст кода их подставлять не нужно.
var rows = XQuery(
  "for $e in collaborators where contains($e/fullname, " + XQueryLiteral(PARAMS.name) + ") return $e"
);
RESULT = [];
for (row in rows) {
  if (ArrayCount(RESULT) >= PARAMS.limit) break;
  RESULT.push({ id: row.id + '', fullname: row.fullname + '' });
}
