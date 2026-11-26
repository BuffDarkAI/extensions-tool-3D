# CVAT 3D Cuboid Helper

Userscript (Tampermonkey) cho trình duyệt, thêm các công cụ fit cuboid nhanh vào giao diện gán nhãn 3D của CVAT. Không cần sửa server.

| Phím / chuột | Ở đâu | Tác dụng |
|---|---|---|
| **G** | chuột ở view 3D lớn, khi đang chọn 1 cuboid | Fit lại cuboid theo cụm điểm quanh nó (cách gom như bản đầu, bắt trọn ô tô). Mỗi mặt chừa 0,1 m (mỗi chiều rộng hơn vật 0,2 m), đáy đặt trên mặt đất. |
| **Ctrl + click trái** | view 3D lớn | Fit cuboid quanh vật chạm tới điểm vừa bấm. Gom chặt, dùng cho vật nhỏ (người, cọc tiêu, xe đạp...) hoặc vật đứng sát hàng rào. Bấm trong cuboid đang chọn thì fit lại cuboid đó. Bấm chỗ khác thì tạo cuboid mới với nhãn đang chọn ở thanh bên trái. |
| **G** | chuột ở trên view Top, Side hoặc Front | Gom lại các phần điểm dày trên mặt phẳng của view đó, bỏ điểm lẻ/rời, rồi fit 2 trục của view (Top: L, W · Side/Front: chiều ngang + H). Trục còn lại và góc xoay giữ nguyên. |
| **Shift + G** | chuột ở trên view Top | Như G, đồng thời tìm lại góc xoay theo cụm vừa gom |
| **Shift + kéo** | view 3D lớn, kéo trúng cuboid đang chọn | Kéo cuboid trượt trên mặt đất. Thả chuột thì đáy đặt sát mặt đất. Esc để huỷ. |
| **J** | trong job 3D | Bật/tắt **khoá sát mặt đất** (mặc định bật, nhớ cho lần sau) |
| **W / D** | chuột ở trên view Top, Side hoặc Front | Nới mặt trên / mặt phải ra ngoài 2 cm. Mặt đối diện giữ nguyên. |
| **S / A** | như trên | Thu mặt dưới / mặt trái vào trong 2 cm (mặt dịch lên / sang phải) |
| **Shift + WASD** | như trên | Đảo lại: Shift+W/D thu mặt trên/phải, Shift+S/A nới mặt dưới/trái |
| **Q** | chuột ở trên view Top | Xoay yaw −1° (giữ Shift: −0,2°) |
| **E** | chuột ở trên view Top | Xoay +90° (Shift+E: −90°). L và W đổi chỗ cho nhau nên khung đáy giữ nguyên, chỉ đổi hướng đầu xe. |
| **↑ ↓ ← →** | chuột ở trên view Top, Side hoặc Front | Dời cuboid 5 cm theo hướng mũi tên trên màn hình (giữ Shift: 1 cm). Kích thước và góc giữ nguyên. Khi khoá sát mặt đất bật, chỉ dời theo mặt ngang và đáy luôn sát đất (↑/↓ ở view Side/Front không có tác dụng). |
| **] / [** | trong job 3D | Điểm to hơn / nhỏ hơn (nhớ cho lần sau) |
| **B** | trong job 3D | Đổi độ sáng điểm: 0 (gốc) → 1 → 2 → 3 |

Khi chuột ở trên 3 view nhỏ, script chặn các phím này nên **D không còn lùi frame**. Rời chuột khỏi 3 view thì D/F hoạt động như cũ.

**Cuboid dạng track:** G, Ctrl+click (khi fit lại cuboid đang chọn) và G trên view Top/Side/Front **không đổi kích thước** nữa. Tool chỉ dời cuboid tới chỗ có nhiều điểm của vật nhất, đáy đặt sát mặt đất. Shift+G ở view Top thì xoay lại nữa, vẫn giữ kích thước. Cuboid dạng shape vẫn fit cả kích thước như trên.

**Đổi kích thước track ở 1 keyframe là đủ:** khi bạn đổi L, W hoặc H của một track ở một frame (bằng WASD, hoặc kéo cạnh như bình thường của CVAT), tool áp kích thước mới cho **mọi keyframe khác** của track đó. Tool chờ 0,8 giây sau lần bấm cuối rồi mới áp, nên bấm WASD liên tục chỉ áp một lần. Ở mỗi keyframe, mặt phía LiDAR giữ nguyên, mặt khuất nới hoặc thu theo, đáy giữ nguyên độ cao. Xoay 90° bằng E chỉ đổi chỗ L và W, kích thước thật không đổi, nên không áp. Keyframe đang khoá (lock) được bỏ qua. Ô thông báo cho biết đã áp cho bao nhiêu keyframe. Mỗi keyframe được sửa là một bước Ctrl+Z riêng.

## Cài làm extension (Chrome, Edge)

Không cần Tampermonkey, không phải dán lại sau mỗi lần tải trang.

1. Đóng gói: chạy `node build-extension.js`. Lệnh này tạo thư mục `dist/cvat3d-cuboid-helper/` (chỉ gồm `manifest.json`, script và icon) và file `dist/cvat3d-cuboid-helper-0.3.0.zip` để chép sang máy khác.
2. Mở `chrome://extensions` (Edge: `edge://extensions`), bật **Developer mode**.
3. Bấm **Load unpacked**, chọn thư mục `dist/cvat3d-cuboid-helper` (hoặc thư mục giải nén từ file zip). Chọn thẳng thư mục `tool_3d` cũng được.
4. Mở hoặc tải lại (F5) trang job 3D. Gõ `cuboidHelper.check()` trong Console để kiểm tra.

Chrome không cho cài thẳng file zip hay `.crx` tự đóng gói: phải giải nén rồi Load unpacked như trên. Muốn cài bằng một cú bấm thì phải đưa lên Chrome Web Store.

Extension chạy chính file `cvat3d-cuboid-helper.user.js`. Sửa file đó xong thì chạy lại `node build-extension.js` (nếu đang dùng thư mục `dist`), bấm nút tải lại (↻) của extension trong `chrome://extensions`, rồi F5 trang CVAT. Extension chạy trên `localhost:8080` và `https://cvat.edufun.ai`. Dùng server khác thì thêm địa chỉ vào `matches` trong `manifest.json`. Cần Chrome/Edge bản 111 trở lên. Đừng bật cùng lúc cả extension và script Tampermonkey: script chỉ chạy 1 lần trên mỗi trang.

## Cài đặt bằng Tampermonkey

1. Cài tiện ích [Tampermonkey](https://www.tampermonkey.net/) cho Chrome, Edge hoặc Firefox.
2. Mở Tampermonkey, chọn **Create a new script**, xóa nội dung mẫu, rồi dán toàn bộ file `cvat3d-cuboid-helper.user.js` vào.
3. Script đang để chạy với **CVAT local** tại `http://localhost:8080` (hoặc `http://127.0.0.1:8080`). Nếu dùng server khác, **thêm một dòng `@match`** với địa chỉ đó, ví dụ `// @match *://cvat.truong.edu.vn/*`. Lưu bằng Ctrl+S.
4. Cho phép Tampermonkey chạy script. Thiếu bước này script không chạy và không báo lỗi.
   - **Chrome:** vào `chrome://extensions`, bấm **Chi tiết** (Details) ở Tampermonkey và bật **Allow User Scripts**. Chrome cũ không có mục này thì bật **Developer mode** ở góc trên bên phải.
   - **Edge:** vào `edge://extensions` và bật **Developer mode** ở cột trái.
   - **Firefox:** không cần bước này.
5. Mở một job 3D, nhấn F12 để mở Console và gõ:
   ```js
   cuboidHelper.check()
   ```
   Kết quả đúng là `store`, `canvas3d`, `viewImpl` đều `true`, và `cloudPoints` lớn hơn 0 (khoảng 30.000 điểm với dữ liệu kiểu nuScenes). `groundLock` cho biết khoá sát mặt đất đang bật hay tắt, `groundSnaps` là số lần tool đã đặt cuboid xuống đất.

## Quy trình gán nhãn đề xuất

**Ô tô và vật lớn:**

1. Tạo cuboid như bình thường, đặt **trùm lên vật** (không cần chính xác) và chọn đúng nhãn.
2. Nếu muốn, xoay cuboid thô cho **gần đúng hướng đầu xe**. Tool fit ra hướng của hình chữ nhật, nhưng không biết đâu là đầu, đâu là đuôi, nên sẽ chọn chiều gần với cuboid thô nhất.
3. Bấm **G** (chuột ở view 3D lớn). Ô thông báo ở góc trái dưới hiện số điểm và L/W/H. Các điểm vừa gom được tô màu hồng vài giây. Dòng ⚠ cảnh báo nếu tool phải đoán, ví dụ khi cụm điểm có thể dính vật khác.
4. Xem lại ở 3 view nhỏ. Nếu cuboid còn dính điểm thừa ở một view, đưa chuột lên view đó và bấm **G** lần nữa để gom lại theo hình 2D. Sau đó chỉnh từng mặt bằng WASD.

**Vật nhỏ, hoặc vật sát hàng rào/tường:** chọn nhãn ở thanh bên trái, rồi **Ctrl + click trái** vào vật trong view 3D lớn. Tool tạo cuboid mới và chọn luôn cuboid đó. Nếu G làm cuboid dính sang hàng rào, Ctrl+click vào vật nằm trong cuboid đó để fit lại.

**Track qua nhiều frame:** sang mỗi frame, nếu cuboid lệch thì Shift+kéo về gần vật (hoặc kéo trong view Top), rồi bấm **G**. Tool chỉ dời cuboid, kích thước giữ nguyên qua mọi frame. Ở frame nào thấy vật rõ nhất thì chỉnh L/W/H bằng WASD ở frame đó, mọi keyframe khác đổi theo.

Cuối cùng bấm **Ctrl+S** để lưu lên server như thường lệ. Ctrl+Z vẫn hoàn tác được.

## Khoá sát mặt đất (phím J)

Khi khoá bật (mặc định), mọi lần **dời** cuboid đều đặt đáy cuboid nằm trên mặt đất ngay dưới nó, nên không kéo cuboid bay lên được:

- kéo cuboid trong view Top, Side, Front như bình thường của CVAT, hoặc Shift+kéo trong view 3D lớn;
- tạo cuboid mới (phím N rồi bấm), dán cuboid (Ctrl+V);
- G trên view Top (tâm cuboid dịch theo mặt đất dốc).

Tool chỉ đặt lại độ cao khi cuboid **chỉ dời chỗ**. Khi bạn đổi kích thước (kéo cạnh, WASD) hoặc xoay, tool không đụng tới, nên vẫn chỉnh được mặt đáy bằng S/Shift+S. Với cuboid kéo bằng CVAT, tool sửa vị trí ngay trước khi CVAT lưu, nên chỉ có 1 bước Ctrl+Z.

**Mặt đất được tìm như thế nào:** nhìn ngang (view Side), mặt đất là vạch dày điểm nhất ở phía dưới, nơi nhiều điểm trùng độ cao nhất. Tool lấy các điểm trong vành rộng 1 m quanh khung đáy cuboid. Điểm bên trong khung đáy bị bỏ, vì đó là điểm của chính vật. Điểm có điểm khác ngay phía trên (5 đến 80 cm, trong bán kính 15 cm) cũng bị bỏ: đó là thành xe, tường, cột, vì tia kế trên luôn rơi ngay phía trên. Tool tính histogram theo độ cao (bước 4 cm), chọn **đỉnh thấp nhất** có ít nhất 30% số điểm của đỉnh cao nhất, rồi fit một mặt phẳng qua lớp điểm đó (dốc tới 20%) để tính đúng cả khi đường dốc. Nếu thiếu điểm, vành được nới ra 2 m rồi 4 m. Nếu kết quả lệch quá 0,5 m so với bản đồ mặt đất (dưới đây), tool dùng bản đồ.

## Gom cụm không tính điểm mặt đất

Trước khi gom (G, Ctrl+click, track), tool bỏ mọi điểm cao hơn mặt đất **ngay dưới nó** không quá 20 cm. Mặt đất ở đây là một **bản đồ theo ô 2 m** quanh vật, không phải một mặt phẳng chung, nên vẫn đúng khi đường dốc, có gờ, lề đường hoặc mặt đường cong:

1. Fit một mặt phẳng RANSAC trong bán kính 12 m để biết độ nghiêng chung.
2. Mỗi ô 2 m lấy lớp điểm thấp dày nhất, chỉ tính các điểm "trống phía trên" như trên.
3. Ô cao hơn các ô xung quanh quá 20 cm bị bỏ, vì đó không phải đất (vd. dưới gầm xe không thấy đất). Ô trống lấy trung bình các ô bên cạnh.

G ở view Top/Side/Front cũng bỏ điểm đất theo mặt đất ngay quanh cuboid như trên.

## Thuật toán

### G ở view 3D lớn (cuboid dạng shape)

1. Bỏ điểm mặt đất (cao dưới 20 cm so với bản đồ mặt đất, xem phần "Gom cụm không tính điểm mặt đất").
2. Lấy điểm hạt giống trong cuboid thô và quanh nó. Bán kính tìm tăng theo kích thước của class, vì LiDAR chỉ thấy bề mặt nên tâm xe thường không có điểm nào.
3. Gom cụm theo khoảng cách từ từng hạt giống. Ngưỡng là 0,35 m, tăng dần theo khoảng cách tới LiDAR, tối đa 0,9 m. Cụm dừng lớn khi vượt 10 m (dài) hoặc 5 m (cao). Trong các cụm tìm được, tool chọn cụm vừa nhiều điểm vừa gần tâm cuboid thô. (Giống bản đầu. Ngưỡng rộng nên bắt trọn ô tô, nhưng có thể dính hàng rào sát bên: khi đó dùng Ctrl+click.)
4. Tìm hướng bằng **L-shape fitting** (tiêu chí closeness). Cách này cho kết quả tốt hơn hình chữ nhật diện tích nhỏ nhất khi chỉ thấy 2 mặt xe.
5. Đáy đặt trên mặt đất ngay dưới hộp (xem phần Khoá sát mặt đất). Đỉnh đặt ở điểm cao nhất, kể cả các điểm rời trên nóc xe.
6. Chừa khoảng hở `FIT_MARGIN` = 0,1 m ở mỗi mặt bên và mặt trên. Muốn mỗi mặt chừa 0,2 m thì sửa thành `FIT_MARGIN: 0.2`; đặt `0` để bao sát.
7. **Kích thước mặc định theo class** (tắt mặc định, bật bằng `USE_PRIOR: true` trong `CFG`). Khi bật: nếu một cạnh đo được ngắn hơn 75% kích thước mặc định, tool dùng kích thước mặc định. Mặt nhìn thấy (phía LiDAR) giữ nguyên, mặt khuất được kéo ra xa. Sửa bảng `PRIORS` ở đầu file cho đúng tên nhãn của bạn.

### Ctrl + click

1. Tool lấy điểm nằm dưới con trỏ (trong bán kính 12 px, chọn điểm gần camera nhất, tức là điểm bạn nhìn thấy ở phía trước). Nếu điểm đó là mặt đất, tool lấy điểm của vật gần nhất trong bán kính 1 m.
2. Gom chặt từ điểm đó: chỉ nhận các điểm **chạm tới nhau** (cách nhau dưới 0,25 m, tăng theo khoảng cách tới LiDAR, tối đa 0,7 m). Một điểm chỉ được lan tiếp khi có ít nhất 3 hàng xóm, nên cụm không bò theo một dãy điểm lẻ. Cụm không lan xa hơn 1,25 × chiều dài mặc định của class + 0,5 m (người: 1,4 m; xe: 6,25 m; nhãn lạ: 3 m).
3. Tính hộp như G (bước 4 đến 6).

### Cuboid dạng track

1. Gom chặt như Ctrl+click từ các điểm trong cuboid nới thêm 1,3 m (cuboid sang frame mới thường lệch chỗ).
2. Chỉ giữ các cụm **vừa với kích thước track**. Hàng rào, tường dài thường dày điểm hơn cả xe nhưng dài hơn cuboid nên bị bỏ. Tool lấy cụm vừa nhiều điểm vừa gần tâm cuboid, rồi ghép thêm các mảnh khác của vật (nóc xe rời qua kính, đầu xe...), miễn tổng vẫn nằm vừa cuboid. Nhờ vậy xe đỗ nối đuôi ngay sau không bị ghép vào.
3. Giữ L, W, H và góc. Tool tìm vị trí của cuboid chứa nhiều điểm của cụm nhất (trong các vị trí bằng nhau, lấy vị trí gần chỗ cũ nhất). Sau đó tool đặt mặt nhìn thấy (phía LiDAR) sát điểm và kéo mặt khuất ra xa: chỉ thấy đuôi xe thì thân xe vẫn đủ dài về phía trước.
4. Đáy đặt trên mặt đất.

### G trên view Top/Side/Front

1. Tool xác định 2 trục của cuboid đang hiện trên view từ camera của view đó. Trục còn lại là chiều sâu.
2. Tool lấy các điểm (bỏ mặt đất) nằm trong cuboid hiện tại, nới thêm 0,3 m theo 2 trục của view và 0,1 m theo chiều sâu.
3. Tool chiếu các điểm lên mặt phẳng của view rồi gom bằng DBSCAN. Một điểm là "dày" khi có ít nhất 3 hàng xóm trong khoảng gom (0,25 m, tăng theo khoảng cách tới LiDAR, tối đa 0,6 m). Theo trục đứng, khoảng gom được nới tới 0,5 m hoặc 1,5 lần khoảng hở giữa 2 tia LiDAR, nên các tia quét trên hông xe và phần nóc (rời thân vì tia xuyên qua kính) vẫn được nối với nhau.
4. Tool chọn cụm vừa nhiều điểm vừa gần tâm cuboid, rồi đặt 2 trục của view bao sát cụm đó cộng `FIT_MARGIN`. Nếu view có trục H, đáy vẫn đặt trên mặt đất. Với Shift+G ở view Top, tool tìm lại hướng bằng L-shape trên cụm đã gom, chọn hướng gần góc hiện tại nhất (trục L, W không đổi chỗ). Với cuboid dạng track, tool chỉ dời cuboid như phần trên.

Lưu ý: ở view Side/Front, mọi điểm theo chiều sâu bị dồn lên một mặt phẳng. Vì vậy vật nằm trước hoặc sau xe (trong vùng của cuboid) sẽ bị tính là một phần của xe. Hãy gom ở view Top trước để chiều sâu đúng, rồi mới gom ở Side/Front.

Toàn bộ thông số nằm trong `CFG` ở đầu file.

## Kết quả trên dữ liệu giả lập

Chạy `node test/fit.test.js`. Các số dưới đây đo khi tắt khoảng hở (`FIT_MARGIN: 0`), trừ phần track. Dữ liệu là LiDAR 32 tia giả lập (bước dọc 1,33°), vật là các hộp hoàn hảo, nhiễu ±2 cm.

**G ở view 3D lớn:**

| Trường hợp | Lệch tâm | L / W | H | Hướng |
|---|---|---|---|---|
| Xe cách 9 m, thấy 2 mặt | 2 cm | ±2 cm | ±2 cm | 0,0° |
| Xe cách 21 m, thấy 2 mặt | 4 cm | ±2 cm | **thấp hơn 21 cm** (khoảng hở giữa 2 tia) | 0,1° |
| Xe chỉ thấy hông | 1 cm | W lấy theo kích thước mặc định | ±2 cm | 0,0° |
| Xe chỉ thấy đuôi | 3 cm | L lấy theo kích thước mặc định | ±2 cm | 0,0° |
| Xe có kính cách 12 m (thân, 4 trụ mảnh, nóc) | 8 cm | L −11 cm, W ±1 cm | +2 cm (bắt được nóc) | 0,0° |
| Người cách 7 m, cột cách 1,2 m | 4 cm | ±4 cm | −5 cm | (không có ý nghĩa) |
| Người dính bụi cây | **28 cm** | **L thừa 50 cm** | đúng | sai |
| Xe đỗ cách hàng rào dài 0,45 m | **dính hàng rào** (L thừa 5,1 m) | | | dùng Ctrl+click |
| Xe đỗ trên dốc 10% (đường phẳng rồi lên dốc) | cụm có 2/396 điểm đất (bản dùng 1 mặt phẳng: 334 điểm đất, L 9,1 m) | L −7 cm, W ±1 cm | đáy đúng mặt dốc (6 mm); đỉnh thiếu do khoảng hở giữa 2 tia | 0,0° |

**Ctrl + click:**

| Trường hợp | Lệch tâm | L / W | H |
|---|---|---|---|
| Xe đỗ cách hàng rào dài 0,45 m | 9 cm | L −13 cm, W ±1 cm | ±1 cm |
| Người cách 7 m, cột cách 1,2 m | 4 cm | ±4 cm | −5 cm |
| Cọc tiêu cách tường 0,4 m | 4 cm | ±5 cm | −2 cm |

**Cuboid dạng track** (kích thước đúng, cuboid lệch chỗ và lơ lửng 0,6 m như khi sang frame mới). Ở mọi trường hợp kích thước giữ nguyên tuyệt đối và đáy về sát đất (±1 cm):

| Trường hợp | Lệch ban đầu | Lệch tâm sau G |
|---|---|---|
| Xe thấy 2 mặt | 0,94 m | 3 cm |
| Chỉ thấy đuôi xe | 1,04 m | 2 cm |
| Xe đỗ cách hàng rào dài 0,45 m | 0,50 m | 3 cm |
| Thân và nóc xe rời nhau (kính, không có trụ) | 0,58 m | 3 cm |
| 2 xe đỗ nối đuôi cách 0,8 m | 0,54 m | 3 cm |
| G ở view Top, có cột cách hông xe 0,5 m | 0,50 m | 2 cm |

**G trên view Top/Side/Front:** cuboid quá to và có cột cách hông xe 0,5 m: view Top bỏ được cột, L/W đúng tới ±1 cm so với phần nhìn thấy. Shift+G với cuboid lệch 8°: xoay về 0,0°. View Side của xe có kính: giữ được nóc (H +2 cm).

**Mặt đất ngay dưới cuboid:** mặt phẳng: lệch 1 mm. Xe dưới đường cạnh vỉa hè cao 15 cm: lấy đúng mặt đường (lệch 3 mm). Người đứng trên vỉa hè: lấy đúng vỉa hè (lệch 1 mm). Dốc 5%: lệch 2 mm. Cuboid lơ lửng 0,9 m trên dốc 10%, khoá đất đặt lại: lệch 1 mm.

Dữ liệu thật sẽ kém hơn: xe không phải hộp vuông, có gương, kính bị tia xuyên qua, mặt đất gồ ghề, và có điểm của xe khác. Với các trường hợp "chỉ thấy 1 mặt", kích thước của mặt khuất **là đoán theo class, không phải đo được**.

`node test/browser.test.js` chạy cả phần trình duyệt của script với một CVAT giả (store Redux, canvas, camera, scene three.js giả): phím G, Ctrl+click tạo/fit lại cuboid, Shift+kéo, khoá mặt đất, phím J, WASD, track. Test này chỉ bắt lỗi trong code của script. CVAT giả được viết theo cách script đoán CVAT hoạt động, nên không thay được việc thử trên CVAT thật.

## Giới hạn và lưu ý

- Script đọc dữ liệu bên trong của CVAT: Redux store, `annotation.canvas.instance`, scene three.js, và các sự kiện `canvas.edited`, `canvas.drawn` của canvas 3D. **Cách làm này chưa được thử trên server CVAT thật.** Nếu `cuboidHelper.check()` báo `false` ở mục nào, hãy chụp lại kết quả cùng phiên bản CVAT (xem ở menu **About**) để sửa.
  - **Lưu thay đổi:** nếu sự kiện `canvas.edited` không có tác dụng, script tự chuyển sang cách dự phòng (`state.save()` + dispatch `UPDATE_ANNOTATIONS_SUCCESS`) và in cảnh báo trong Console.
  - **Ctrl+click tạo cuboid mới** giả lập sự kiện "vẽ xong cuboid" (`canvas.drawn`) của CVAT. Nếu CVAT của bạn không nhận, ô thông báo sẽ báo đỏ. Khi đó hãy vẽ hoặc chọn 1 cuboid, rồi Ctrl+click vào vật nằm trong cuboid đó để fit lại.
  - **Khoá mặt đất khi kéo bằng CVAT** dựa vào sự kiện `canvas.edited` mà CVAT phát khi bạn thả chuột. Nếu kéo xong mà cuboid vẫn lơ lửng và `groundSnaps` trong `check()` không tăng, hãy báo lại phiên bản CVAT. Shift+kéo trong view 3D lớn vẫn đặt sát đất vì do script tự lưu.
  - **Shift+kéo** di chuyển hình cuboid trong view 3D bằng cách tìm mesh có tên là `clientID`. Nếu không tìm thấy, tool vẽ một khung chấm xanh để bạn thấy vị trí mới.
  - **Áp kích thước track cho mọi keyframe** đọc keyframe qua API của cvat-core (`job.annotations.get(frame)`, `keyframes.first/next`, `state.save()`). Nếu CVAT của bạn không có API này, ô thông báo báo đỏ và chỉ frame vừa sửa đổi kích thước. Có thể tắt bằng `TRACK_SYNC_SIZE: false`. `trackSizeSyncs` trong `check()` là số keyframe đã được áp.
- Hướng WASD được tính từ camera của từng view: tool chọn trục của cuboid gần nhất với hướng phím trên màn hình. Vì vậy phím luôn kéo đúng mặt bạn đang nhìn, dù view có xoay.
- Phím G (và Shift+G) bị chặn khi đang chọn cuboid, nên chế độ nhóm của CVAT (G, Shift+G) chỉ dùng được khi không chọn cuboid nào. Nếu cần, đổi `FIT_KEY` trong `CFG`. Phím J đổi được bằng `LOCK_KEY`.
- Ctrl+click và Shift+kéo trong view 3D lớn bị script giữ lại, CVAT không nhận cú bấm đó. Shift+kéo chỉ bị giữ khi bấm trúng cuboid đang chọn.
- **Hãy hỏi giảng viên trước** khi dùng: bài tập luyện gán nhãn có thể không cho phép công cụ tự động.
