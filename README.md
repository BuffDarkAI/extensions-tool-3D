# CVAT 3D Cuboid Helper

Userscript (Tampermonkey) cho trình duyệt, thêm 2 tính năng vào giao diện gán nhãn 3D của CVAT. Không cần sửa server.

| Phím | Ở đâu | Tác dụng |
|---|---|---|
| **G** | bất kỳ đâu, khi đang chọn 1 cuboid | Fit lại cuboid theo cụm điểm quanh nó |
| **W / D** | chuột ở trên view Top, Side hoặc Front | Nới mặt trên / mặt phải ra ngoài 2 cm. Mặt đối diện giữ nguyên. |
| **S / A** | như trên | Thu mặt dưới / mặt trái vào trong 2 cm (mặt dịch lên / sang phải) |
| **Shift + WASD** | như trên | Đảo lại: Shift+W/D thu mặt trên/phải, Shift+S/A nới mặt dưới/trái |
| **Q / E** | chuột ở trên view Top | Xoay yaw −1° / +1° (giữ Shift: 0,2°) |
| **] / [** | trong job 3D | Điểm to hơn / nhỏ hơn (nhớ cho lần sau) |
| **B** | trong job 3D | Đổi độ sáng điểm: 0 (gốc) → 1 → 2 → 3 |

Khi chuột ở trên 3 view nhỏ, script chặn các phím này nên **D không còn lùi frame**. Rời chuột khỏi 3 view thì D/F hoạt động như cũ.

## Cài đặt

1. Cài tiện ích [Tampermonkey](https://www.tampermonkey.net/) cho Chrome, Edge hoặc Firefox.
2. Mở Tampermonkey, chọn **Create a new script**, xóa nội dung mẫu, rồi dán toàn bộ file `cvat3d-cuboid-helper.user.js` vào.
3. **Sửa dòng `@match`** thành địa chỉ CVAT của khóa học, ví dụ `// @match *://cvat.truong.edu.vn/*`. Lưu bằng Ctrl+S.
4. Cho phép Tampermonkey chạy script. Thiếu bước này script không chạy và không báo lỗi.
   - **Chrome:** vào `chrome://extensions`, bấm **Chi tiết** (Details) ở Tampermonkey và bật **Allow User Scripts**. Chrome cũ không có mục này thì bật **Developer mode** ở góc trên bên phải.
   - **Edge:** vào `edge://extensions` và bật **Developer mode** ở cột trái.
   - **Firefox:** không cần bước này.
5. Mở một job 3D, nhấn F12 để mở Console và gõ:
   ```js
   cuboidHelper.check()
   ```
   Kết quả đúng là `store`, `canvas3d`, `viewImpl` đều `true`, và `cloudPoints` lớn hơn 0 (khoảng 30.000 điểm với dữ liệu kiểu nuScenes).

## Quy trình gán nhãn đề xuất

1. Tạo cuboid như bình thường, đặt **trùm lên vật** (không cần chính xác) và chọn đúng nhãn.
2. Nếu muốn, xoay cuboid thô cho **gần đúng hướng đầu xe**. Tool fit ra hướng của hình chữ nhật, nhưng không biết đâu là đầu, đâu là đuôi, nên sẽ chọn chiều gần với cuboid thô nhất.
3. Bấm **G**. Ô thông báo ở góc trái dưới hiện số điểm và L/W/H. Dòng ⚠ cảnh báo nếu tool phải đoán, ví dụ khi phải dùng kích thước mặc định hoặc cụm điểm có thể dính vật khác.
4. Xem lại ở 3 view nhỏ, rồi chỉnh từng mặt bằng WASD. Kiểm tra hướng bằng camera.
5. **Ctrl+S** để lưu lên server như thường lệ. Ctrl+Z vẫn hoàn tác được.

## Thuật toán fit (phím G)

1. Ước lượng mặt đất trong bán kính 12 m bằng RANSAC, chỉ nhận mặt gần nằm ngang.
2. Bỏ các điểm cao dưới 20 cm so với mặt đất.
3. Lấy điểm hạt giống trong cuboid thô và quanh nó. Bán kính tìm tăng theo kích thước của class, vì LiDAR chỉ thấy bề mặt nên tâm xe thường không có điểm nào.
4. Gom cụm theo khoảng cách. Ngưỡng là 0,35 m, tăng dần theo khoảng cách tới LiDAR, tối đa 0,9 m. Cụm dừng lớn khi vượt 10 m (dài) hoặc 5 m (cao). Trong các cụm tìm được, tool chọn cụm vừa nhiều điểm vừa gần tâm cuboid thô.
5. Tìm hướng bằng **L-shape fitting** (tiêu chí closeness). Cách này cho kết quả tốt hơn hình chữ nhật diện tích nhỏ nhất khi chỉ thấy 2 mặt xe.
6. Đáy đặt bằng mặt đất tại tâm hộp. Đỉnh đặt ở điểm cao nhất, kể cả các điểm rời trên nóc xe.
7. **Kích thước mặc định theo class** (tắt mặc định, bật bằng `USE_PRIOR: true` trong `CFG`). Khi tắt, cuboid bao sát cụm điểm: tâm là tâm khung bao, chiều dài theo cạnh dài nhất. Khi bật: nếu một cạnh đo được ngắn hơn 75% kích thước mặc định, tool dùng kích thước mặc định. Mặt nhìn thấy (phía LiDAR) giữ nguyên, mặt khuất được kéo ra xa. Sửa bảng `PRIORS` ở đầu file cho đúng tên nhãn của bạn.

Toàn bộ thông số nằm trong `CFG` ở đầu file.

## Kết quả trên dữ liệu giả lập

Chạy `node test/fit.test.js`. Dữ liệu là LiDAR 32 tia giả lập (bước dọc 1,33°), mặt đất phẳng, vật là các hộp hoàn hảo, nhiễu ±2 cm:

| Trường hợp | Lệch tâm | L / W | H | Hướng |
|---|---|---|---|---|
| Xe cách 9 m, thấy 2 mặt | 2 cm | ±2 cm | ±2 cm | 0,0° |
| Xe cách 21 m, thấy 2 mặt | 4 cm | ±2 cm | **thấp hơn 21 cm** (khoảng hở giữa 2 tia) | 0,1° |
| Xe chỉ thấy hông | 1 cm | W lấy theo kích thước mặc định | ±2 cm | 0,0° |
| Xe chỉ thấy đuôi | 3 cm | L lấy theo kích thước mặc định | ±2 cm | 0,0° |
| Người cách 7 m, cột cách 1,2 m | 4 cm | ±4 cm | −5 cm | (không có ý nghĩa) |
| Người dính bụi cây | **28 cm** | **L thừa 50 cm** | đúng | sai |

Dữ liệu thật sẽ kém hơn: xe không phải hộp vuông, có gương, kính bị tia xuyên qua, mặt đất dốc, và có điểm của xe khác. Với các trường hợp "chỉ thấy 1 mặt", kích thước của mặt khuất **là đoán theo class, không phải đo được**.

## Giới hạn và lưu ý

- Script đọc dữ liệu bên trong của CVAT: Redux store, `annotation.canvas.instance`, scene three.js, và sự kiện `canvas.edited`. **Cách làm này chưa được thử trên server CVAT thật.** Phần dễ hỏng nhất là cách lưu thay đổi. Nếu sự kiện `canvas.edited` không có tác dụng, script tự chuyển sang cách dự phòng (`state.save()` + dispatch `UPDATE_ANNOTATIONS_SUCCESS`) và in cảnh báo trong Console. Nếu `cuboidHelper.check()` báo `false` ở mục nào, hãy chụp lại kết quả cùng phiên bản CVAT (xem ở menu **About**) để sửa.
- Hướng WASD được tính từ camera của từng view: tool chọn trục của cuboid gần nhất với hướng phím trên màn hình. Vì vậy phím luôn kéo đúng mặt bạn đang nhìn, dù view có xoay.
- Phím G bị chặn khi đang chọn cuboid. Nếu CVAT của bạn dùng G cho việc khác, đổi `FIT_KEY` trong `CFG`.
- **Hãy hỏi giảng viên trước** khi dùng: bài tập luyện gán nhãn có thể không cho phép công cụ tự động.
