use crate::float_types::Real;
use nalgebra::{Vector3, Rotation3, Unit, UnitQuaternion, Quaternion};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsValue;

#[wasm_bindgen]
pub struct Vector3Js {
    pub(crate) inner: Vector3<Real>,
}

#[wasm_bindgen]
impl Vector3Js {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64, z: f64) -> Vector3Js {
        Vector3Js {
            inner: Vector3::new(x as Real, y as Real, z as Real),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f64 {
        self.inner.x as f64
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f64 {
        self.inner.y as f64
    }

    #[wasm_bindgen(getter)]
    pub fn z(&self) -> f64 {
        self.inner.z as f64
    }

    /* Meshup: basic Vector calculation methods */
    pub fn length(&self) -> f64
    {
        self.inner.norm() as f64
    }

    pub fn normalize(&self) -> Vector3Js
    {
        Vector3Js {
            inner: self.inner.normalize()
        }
    }

    #[wasm_bindgen(js_name = isOrthogonal)]
    pub fn is_orthogonal(&self, tolerance: f64) -> bool
    {
        self.inner.is_orthogonal(tolerance)
    }

    pub fn abs(&self) -> Vector3Js
    {
        Vector3Js {
            inner: self.inner.abs()
        }
    }

    pub fn reverse(&self) -> Vector3Js
    {
        Vector3Js {
            inner: self.inner.scale(-1.0) // TODO: fix neg ()
        }
    }

    pub fn add(&self, other: &Vector3Js) -> Vector3Js
    {
        Vector3Js {
            inner: self.inner + other.inner
        }
    }

    pub fn subtract(&self, other: &Vector3Js) -> Vector3Js
    {
        Vector3Js {
            inner: self.inner - other.inner
        }
    }

    pub fn dot(&self, other: &Vector3Js) -> f64 
    {
        self.inner.dot(&other.inner) as f64
    }

    pub fn equals(&self, other: &Vector3Js) -> bool
    {
        self.inner.eq(&other.inner)
    }

    pub fn angle(&self, other: &Vector3Js) -> f64 
    {
        self.inner.angle(&other.inner) as f64
    }

    pub fn scale(&self, factor: f64) -> Vector3Js
    {
        Vector3Js {
            inner: self.inner.scale(factor as Real)
        }
    }

    // Rotate the vector around a given axis by a certain angle in radians
    pub fn rotate(&self, axis: &Vector3Js, angle: f64) -> Vector3Js
    {
        let axis_norm = Unit::new_normalize(axis.inner);
        let rotation = Rotation3::from_axis_angle(&axis_norm, angle as Real);
        Vector3Js {
            inner: rotation * self.inner
        }
    }

    /// Rotate this vector by a unit quaternion given as components `(w, x, y, z)`.
    /// The quaternion is expected to be unit-length.
    #[wasm_bindgen(js_name = rotateQuaternion)]
    pub fn rotate_quaternion(&self, w: f64, x: f64, y: f64, z: f64) -> Vector3Js {
        
        let q = UnitQuaternion::new_normalize(Quaternion::new(
            w as Real, x as Real, y as Real, z as Real,
        ));
        Vector3Js {
            inner: q * self.inner,
        }
    }

    pub fn cross(&self, other: &Vector3Js) -> Vector3Js
    {
        Vector3Js {
            inner: self.inner.cross(&other.inner)
        }
    }

    /// Compute the shortest-arc unit quaternion that rotates `self` to align with `other`.
    /// Returns a plain JS object `{ w, x, y, z }`.
    /// For anti-parallel vectors, a 180° rotation around a perpendicular axis is chosen.
    #[wasm_bindgen(js_name = rotationBetween)]
    pub fn rotation_between(&self, other: &Vector3Js) -> Result<JsValue, JsValue> {
        let a = self.inner.normalize();
        let b = other.inner.normalize();
        let q = match UnitQuaternion::rotation_between(&a, &b) {
            Some(q) => q,
            None => {
                // Vectors are anti-parallel — rotate 180° around a perpendicular axis
                let perp = if a.x.abs() < 0.9 {
                    Unit::new_normalize(a.cross(&Vector3::x()))
                } else {
                    Unit::new_normalize(a.cross(&Vector3::y()))
                };
                UnitQuaternion::from_axis_angle(&perp, std::f64::consts::PI as Real)
            }
        };
        let w = q.scalar() as f64;
        let v = q.vector();
        let obj = js_sys::Object::new();
        js_sys::Reflect::set(&obj, &JsValue::from_str("w"), &JsValue::from_f64(w))?;
        js_sys::Reflect::set(&obj, &JsValue::from_str("x"), &JsValue::from_f64(v.x as f64))?;
        js_sys::Reflect::set(&obj, &JsValue::from_str("y"), &JsValue::from_f64(v.y as f64))?;
        js_sys::Reflect::set(&obj, &JsValue::from_str("z"), &JsValue::from_f64(v.z as f64))?;
        Ok(obj.into())
    }

    

}

// Rust-only conversions
impl From<Vector3<Real>> for Vector3Js {
    fn from(v: Vector3<Real>) -> Self {
        Vector3Js { inner: v }
    }
}

impl From<&Vector3Js> for Vector3<Real> {
    fn from(v: &Vector3Js) -> Self {
        v.inner
    }
}
